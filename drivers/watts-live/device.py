from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from typing import Any

from homey import device

try:
    from homey_watts_live.constants import (
        ADDED_CAPABILITIES_V1_TO_V2,
        ENERGY_CAPABILITIES_IN_KW,
        READING_TO_CAPABILITY_MAP,
        REMOVED_CAPABILITIES_V1_TO_V2,
    )
    from homey_watts_live.models import DriverSettings, MeterReading
    from homey_watts_live.mqtt import MqttWrapper
except ModuleNotFoundError:
    from app.homey_watts_live.constants import (
        ADDED_CAPABILITIES_V1_TO_V2,
        ENERGY_CAPABILITIES_IN_KW,
        READING_TO_CAPABILITY_MAP,
        REMOVED_CAPABILITIES_V1_TO_V2,
    )
    from app.homey_watts_live.models import DriverSettings, MeterReading
    from app.homey_watts_live.mqtt import MqttWrapper


class WattsLiveDevice(device.Device):
    async def on_init(self) -> None:
        await super().on_init()
        self.runtime_debug = False
        self.settings_debug = self.get_setting("debugLogging") is True
        self.mqtt_wrapper: MqttWrapper | None = None
        self.debug_log_lines: list[str] = []
        self.message_count = 0
        self.reconnect_attempt = 0
        self.reconnect_task: asyncio.Task[None] | None = None
        self.is_deleted = False
        self.is_handling_settings = False

        await self.migrate_to_new_mqtt_connectivity()
        await self.migrate_mqtt_settings_ui()
        await self.migrate_capabilities()
        await self.append_debug_log("Device initialized")

        try:
            await self.reconnect_mqtt()
        except Exception as err:
            self.error("Initial MQTT connection failed", err)
            await self.append_debug_log(f"Initial MQTT connection failed: {err}")
            await self.invalidate_status()
            self.schedule_reconnect("initial connection failed")

    async def on_added(self) -> None:
        await self.set_available()
        await self.append_debug_log(f"Device added: {self.get_setting('deviceId')}")

    async def on_deleted(self) -> None:
        self.is_deleted = True
        if self.reconnect_task is not None:
            self.reconnect_task.cancel()
            self.reconnect_task = None
        if self.mqtt_wrapper is not None:
            await self.append_debug_log("Device deleted; disconnecting MQTT")
            await self.mqtt_wrapper.disconnect()

    async def on_renamed(self, name: str) -> None:
        await self.append_debug_log(f"Device renamed: {name}")

    async def on_settings(
        self,
        old_settings: dict[str, bool | float | str | None],
        new_settings: dict[str, bool | float | str | None],
        changed_keys: tuple[str, ...],
    ) -> str | None:
        self.is_handling_settings = True
        try:
            next_settings_debug = new_settings.get("debugLogging") is True
            if not self.settings_debug and next_settings_debug:
                self.settings_debug = True
                await self.append_debug_log("Debug logging enabled")
            elif self.settings_debug and not next_settings_debug:
                await self.append_debug_log("Debug logging disabled")
                self.settings_debug = False
            else:
                self.settings_debug = next_settings_debug

            await self.append_debug_log(f"Settings updated: {', '.join(changed_keys)}")

            needs_reconnect = any(
                key in {
                    "hostname",
                    "port",
                    "clientId",
                    "username",
                    "password",
                    "useTls",
                    "useHomeyMqttClient",
                    "useCustomMqttClient",
                    "deviceId",
                    "acceptSelfSignedCert",
                }
                for key in changed_keys
            )

            if needs_reconnect:
                await self.append_debug_log("Reconnecting due to MQTT setting changes")
                try:
                    await self.reconnect_mqtt(DriverSettings(new_settings))
                except Exception:
                    await self.reconnect_mqtt(DriverSettings(old_settings))
                    raise
        finally:
            self.is_handling_settings = False

        return None

    def get_device_settings(self) -> DriverSettings:
        settings = dict(self.get_settings())
        return DriverSettings(settings)

    async def append_debug_log(self, message: str) -> None:
        if not self.settings_debug:
            return
        self.debug_log_lines.append(message)
        self.debug_log_lines = self.debug_log_lines[-100:]

    async def on_message(self, topic: str, message: Any) -> None:
        self.message_count += 1
        await self.process_mqtt_message(topic, message)

    async def process_mqtt_message(self, topic: str, message: Any) -> None:
        try:
            payload = self._parse_payload(message)
            if payload is None:
                return

            readings = MeterReading.from_payload(payload)
            capability_values: dict[str, float] = {}
            for reading_name, capability_id in READING_TO_CAPABILITY_MAP.items():
                if reading_name not in readings.values:
                    continue

                value = readings.values[reading_name]
                if capability_id in ENERGY_CAPABILITIES_IN_KW:
                    value = value / 1000

                capability_values[capability_id] = value

            for capability_id, value in capability_values.items():
                if not self.has_capability(capability_id):
                    continue
                current_value = self.get_capability_value(capability_id)
                if current_value == value:
                    continue
                await self.set_capability_value(capability_id, value)
        except Exception as err:
            self.error("process_mqtt_message error", err)
            await self.append_debug_log(f"process_mqtt_message error on {topic}: {err}")

    def _parse_payload(self, message: Any) -> dict[str, Any] | None:
        if isinstance(message, Mapping):
            return dict(message)
        if isinstance(message, (bytes, bytearray)):
            return json.loads(message.decode("utf-8"))
        if isinstance(message, str):
            return json.loads(message)
        return None

    async def invalidate_status(self) -> None:
        await self.set_unavailable("Device disconnected or unavailable")

    def schedule_reconnect(self, reason: str) -> None:
        if self.is_deleted or self.reconnect_task is not None:
            return

        delay_ms = min(30000, 2000 * (2**self.reconnect_attempt))
        self.reconnect_attempt += 1

        async def delayed_reconnect() -> None:
            try:
                await asyncio.sleep(delay_ms / 1000)
                await self.reconnect_mqtt()
            except Exception as err:
                self.error("MQTT reconnect attempt failed", err)
                await self.append_debug_log(f"MQTT reconnect attempt failed: {err}")
                await self.invalidate_status()
                self.schedule_reconnect("retry failed")
            finally:
                self.reconnect_task = None

        self.log(f"Scheduling MQTT reconnect in {delay_ms}ms ({reason})")
        self.reconnect_task = asyncio.create_task(
            delayed_reconnect(),
            name=f"watts-live-reconnect:{reason}",
        )

    async def reconnect_mqtt(self, new_settings: DriverSettings | None = None) -> None:
        if self.is_deleted:
            return

        if self.reconnect_task is not None:
            self.reconnect_task.cancel()
            self.reconnect_task = None

        if self.mqtt_wrapper is not None:
            await self.mqtt_wrapper.disconnect()

        settings = new_settings or self.get_device_settings()
        mqtt_wrapper = MqttWrapper(self.homey, settings)
        self.mqtt_wrapper = mqtt_wrapper

        mqtt_wrapper.on("disconnect", self._handle_disconnect)
        mqtt_wrapper.on("error", self._handle_mqtt_error)
        mqtt_wrapper.on("message", self._handle_message)

        await mqtt_wrapper.connect()
        await mqtt_wrapper.subscribe(f"watts/{settings.deviceId}/measurement")
        self.reconnect_attempt = 0
        await self.set_available()
        await self.append_debug_log(
            f"Subscribed to watts/{settings.deviceId}/measurement"
        )

    def _handle_disconnect(self) -> None:
        if self.is_deleted:
            return
        asyncio.create_task(self.invalidate_status())
        self.schedule_reconnect("disconnect event")

    def _handle_mqtt_error(self, error: Exception) -> None:
        asyncio.create_task(
            self.append_debug_log(f"MQTT error event received: {error}")
        )

    def _handle_message(self, topic: str, message: Any) -> None:
        asyncio.create_task(self.on_message(topic, message))

    async def migrate_to_new_mqtt_connectivity(self) -> None:
        if self.get_setting("useHomeyMqttClient"):
            return
        device_id = self.get_setting("deviceId") or ""
        await self.set_settings(DriverSettings.driver_settings_default(device_id).__dict__)

    async def migrate_mqtt_settings_ui(self) -> None:
        if self.get_setting("useCustomMqttClient") is not None:
            return

        current_mode = self.get_setting("useHomeyMqttClient")
        use_custom = current_mode == "custom"
        await self.set_settings({"useCustomMqttClient": use_custom})

    async def migrate_capabilities(self) -> None:
        capabilities = self.get_capabilities()

        if "meter_power" in capabilities:
            await self.remove_capability("meter_power")
            await self.add_capability("meter_power.imported")

        if "measure_negative_active_energy" in capabilities:
            await self.remove_capability("measure_negative_active_energy")
            await self.add_capability("meter_power.exported")

        for capability_id in REMOVED_CAPABILITIES_V1_TO_V2:
            if capability_id in self.get_capabilities():
                await self.remove_capability(capability_id)

        for capability_id in ADDED_CAPABILITIES_V1_TO_V2:
            if not self.has_capability(capability_id):
                await self.add_capability(capability_id)


homey_export = WattsLiveDevice
