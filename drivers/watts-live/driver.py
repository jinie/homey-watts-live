from __future__ import annotations

import asyncio
from typing import Any

from homey import driver
from homey.pair_session import PairSession

try:
    from homey_watts_live.models import DiscoveredDevice, DriverSettings
    from homey_watts_live.mqtt import MQTT_API_APP_ID, MqttWrapper
except ModuleNotFoundError:
    from app.homey_watts_live.models import DiscoveredDevice, DriverSettings
    from app.homey_watts_live.mqtt import MQTT_API_APP_ID, MqttWrapper


class WattsLiveDriver(driver.Driver):
    topic = "watts/+/measurement"
    discovery_timeout_ms = 20_000

    async def on_init(self) -> None:
        await super().on_init()
        self.mqtt_wrapper: MqttWrapper | None = None
        self.discovered_devices: list[dict[str, Any]] = []
        self.driver_settings: DriverSettings | None = None
        self.is_pairing_connection_in_progress = False
        self.log("WattsLiveDriver initialized")

    async def on_pair(self, session: PairSession) -> None:
        await super().on_pair(session)
        api_app_available = await self._is_api_app_available()
        self.discovered_devices = []
        await session.show_view("choose_mqtt_method")

        async def get_api_state(_data: Any) -> dict[str, bool]:
            return {"apiAppAvailable": api_app_available}

        async def show_error(error_message: str) -> None:
            await session.emit(
                "showViewNotification",
                {
                    "type": "error",
                    "message": error_message,
                },
            )

        async def choose_mqtt_method(data: dict[str, Any]) -> bool:
            return await self._choose_mqtt_method(data, api_app_available)

        async def start_discovery(_data: Any) -> bool:
            await self._start_discovery()
            return True

        async def list_devices(_data: Any) -> list[dict[str, Any]]:
            await self._start_discovery()
            return self.discovered_devices

        async def get_device(_data: Any) -> dict[str, Any]:
            if not self.discovered_devices:
                raise RuntimeError("No devices discovered during pairing")
            return self.discovered_devices[0]

        session.set_handler("get_api_state", get_api_state)
        session.set_handler("error", show_error)
        session.set_handler("choose_mqtt_method", choose_mqtt_method)
        session.set_handler("start_discovery", start_discovery)
        session.set_handler("list_devices", list_devices)
        session.set_handler("get_device", get_device)

    async def _is_api_app_available(self) -> bool:
        try:
            mqtt_api_app = self.homey.api.get_api_app(MQTT_API_APP_ID)
            return await mqtt_api_app.get_installed()
        except Exception as err:
            self.log("ApiApp not available:", err)
            return False

    async def _choose_mqtt_method(
        self,
        settings: dict[str, Any],
        api_app_available: bool,
    ) -> bool:
        if self.is_pairing_connection_in_progress:
            raise RuntimeError("A connection attempt is already in progress")

        self.is_pairing_connection_in_progress = True
        try:
            if settings.get("useHomeyMqttClient") == "homey" and not api_app_available:
                raise RuntimeError("MQTT Client App is not installed")

            if self.mqtt_wrapper is not None:
                await self.mqtt_wrapper.disconnect()
                self.mqtt_wrapper = None

            self.driver_settings = DriverSettings(settings)
            self.log(f"Pairing settings: {self.driver_settings.to_safe_json()}")
            self.mqtt_wrapper = MqttWrapper(self.homey, self.driver_settings)
            await asyncio.wait_for(self.mqtt_wrapper.connect(), timeout=10)
            return True
        except asyncio.TimeoutError as err:
            raise RuntimeError("MQTT connection timeout after 10000ms") from err
        except Exception:
            if self.mqtt_wrapper is not None:
                await self.mqtt_wrapper.disconnect()
                self.mqtt_wrapper = None
            raise
        finally:
            self.is_pairing_connection_in_progress = False

    async def _start_discovery(self) -> bool:
        if self.discovered_devices:
            safe_devices = [
                {
                    **device,
                    "settings": DriverSettings(device["settings"]).to_safe_dict(),
                }
                for device in self.discovered_devices
            ]
            self.log(f"Returning cached discovered devices: {safe_devices}")
            return True

        if self.mqtt_wrapper is None:
            raise RuntimeError("MQTT wrapper is not initialized")

        self.log(
            f"Starting discovery on topic {self.topic} for {self.discovery_timeout_ms}ms"
        )
        try:
            discovered_devices = await self.mqtt_wrapper.discover_devices(
                self.topic,
                self.discovery_timeout_ms,
            )
        finally:
            await self.mqtt_wrapper.disconnect()
            self.mqtt_wrapper = None

        paired_ids = {
            paired_device.get_setting("deviceId")
            for paired_device in self.get_devices()
        }

        unique_discovered_devices: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for discovered_device in discovered_devices:
            if discovered_device.id in paired_ids or discovered_device.id in seen_ids:
                continue

            seen_ids.add(discovered_device.id)
            settings = self._create_driver_settings_from_data(
                discovered_device,
                self.driver_settings or DriverSettings(),
            )
            unique_discovered_devices.append(
                {
                    "id": discovered_device.id,
                    "name": discovered_device.name,
                    "data": {"id": discovered_device.id},
                    "settings": settings.__dict__,
                }
            )

        self.discovered_devices = unique_discovered_devices
        safe_devices = [
            {
                **device,
                "settings": DriverSettings(device["settings"]).to_safe_dict(),
            }
            for device in self.discovered_devices
        ]
        self.log(f"Discovery complete. Returning devices: {safe_devices}")
        return True

    def _create_driver_settings_from_data(
        self,
        device_data: DiscoveredDevice,
        settings: DriverSettings,
    ) -> DriverSettings:
        new_settings = DriverSettings(settings)
        new_settings.deviceId = device_data.id
        return new_settings


homey_export = WattsLiveDriver
