from __future__ import annotations

import asyncio
import json
import ssl
from collections.abc import Callable
from typing import Any

from .events import EventEmitter
from .models import DiscoveredDevice, DriverSettings

MQTT_API_APP_ID = "nl.scanno.mqtt"


class HomeyMqttConnector(EventEmitter):
    def __init__(self, homey: Any) -> None:
        super().__init__()
        self.homey = homey
        self.mqtt_client = self.homey.api.get_api_app(MQTT_API_APP_ID)
        self.is_connected = False
        self.topics: list[str] = []
        self.realtime_listener_bound = False
        self.api_lifecycle_listeners_bound = False

    async def connect(self) -> None:
        if self.is_connected:
            return

        if not await self.mqtt_client.get_installed():
            raise RuntimeError(f"{MQTT_API_APP_ID} app not found or unavailable")

        await self._register_api_app()
        self._bind_api_app_listeners()
        self.is_connected = True
        self.emit("connect")

    async def disconnect(self) -> None:
        if not self.is_connected:
            return

        for topic in list(self.topics):
            await self.unsubscribe(topic)

        self._remove_api_app_listeners()
        self.is_connected = False
        self.emit("disconnect")

    async def subscribe(self, topic: str) -> None:
        await self._register_api_app()
        self._bind_api_app_listeners()
        response = await self.mqtt_client.post("subscribe", {"topic": topic})
        if isinstance(response, dict) and response.get("result") != 0:
            raise RuntimeError(f"Cannot subscribe to topic {topic}: {response}")
        if topic not in self.topics:
            self.topics.append(topic)
        self.homey.log(f"Homey MQTT subscribed to topic: {topic}")

    async def unsubscribe(self, topic: str) -> None:
        response = await self.mqtt_client.post("unsubscribe", {"topic": topic})
        if isinstance(response, dict) and response.get("result") != 0:
            raise RuntimeError(f"Cannot unsubscribe from topic {topic}: {response}")
        self.topics = [current for current in self.topics if current != topic]
        self.homey.log(f"Homey MQTT unsubscribed from topic: {topic}")

    async def discover_devices(
        self,
        topic: str,
        timeout: int = 20_000,
    ) -> list[DiscoveredDevice]:
        devices: dict[str, DiscoveredDevice] = {}

        def on_message(received_topic: str, _message: Any) -> None:
            device_id = _extract_device_id(received_topic)
            if not device_id or device_id in devices:
                return

            devices[device_id] = DiscoveredDevice(
                id=device_id,
                name=f"Watts Live - {device_id}",
                data={"id": device_id},
                settings={"deviceId": device_id},
            )

        self.homey.log(f"Starting Homey MQTT discovery on topic: {topic}")
        self.on("message", on_message)
        await self.subscribe(topic)
        try:
            await asyncio.sleep(timeout / 1000)
        finally:
            self.off("message", on_message)
            await self.unsubscribe(topic)

        self.homey.log(f"Homey MQTT discovery complete. Devices found: {len(devices)}")
        return list(devices.values())

    async def _register_api_app(self) -> None:
        register = getattr(self.mqtt_client, "register", None)
        if callable(register):
            await register()

    def _bind_api_app_listeners(self) -> None:
        if not self.realtime_listener_bound:
            self.mqtt_client.on_realtime(self._on_realtime_message)
            self.realtime_listener_bound = True

        if not self.api_lifecycle_listeners_bound:
            self.mqtt_client.on_install(self._on_install)
            self.mqtt_client.on_uninstall(self._on_uninstall)
            self.api_lifecycle_listeners_bound = True

    def _remove_api_app_listeners(self) -> None:
        if self.realtime_listener_bound:
            self.mqtt_client.remove_listener("realtime", self._on_realtime_message)
            self.realtime_listener_bound = False

        if self.api_lifecycle_listeners_bound:
            self.mqtt_client.remove_listener("install", self._on_install)
            self.mqtt_client.remove_listener("uninstall", self._on_uninstall)
            self.api_lifecycle_listeners_bound = False

    def _on_realtime_message(self, *args: Any) -> None:
        if len(args) >= 2 and isinstance(args[0], str):
            self.emit("message", args[0], args[1])
            return

        if len(args) == 1 and isinstance(args[0], dict):
            topic = args[0].get("topic")
            message = args[0].get("message")
            if isinstance(topic, str):
                self.emit("message", topic, message)

    def _on_install(self, *_args: Any) -> None:
        self.is_connected = True
        self.emit("connect")

    def _on_uninstall(self, *_args: Any) -> None:
        self.is_connected = False
        self.emit("disconnect")


class CustomMqttConnector(EventEmitter):
    def __init__(self, homey: Any, driver_settings: DriverSettings) -> None:
        super().__init__()
        self.homey = homey
        self.driver_settings = driver_settings
        self.client: Any = None
        self.connected_event: asyncio.Event | None = None
        self.connect_error: Exception | None = None
        self.loop: asyncio.AbstractEventLoop | None = None

    def _emit_on_loop(self, event: str, *args: Any) -> None:
        if self.loop is None:
            self.emit(event, *args)
            return
        self.loop.call_soon_threadsafe(self.emit, event, *args)

    async def connect(self) -> None:
        if self.client is not None:
            return

        try:
            import paho.mqtt.client as mqtt
        except ImportError as err:
            raise RuntimeError(
                "paho-mqtt is not bundled. Install it into python_packages/arm64 and python_packages/amd64 before deploying."
            ) from err

        self.loop = asyncio.get_running_loop()
        self.connected_event = asyncio.Event()
        self.connect_error = None

        callback_api_version = getattr(mqtt, "CallbackAPIVersion", None)
        if callback_api_version is not None:
            self.client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id=self.driver_settings.clientId,
            )
        else:
            self.client = mqtt.Client(client_id=self.driver_settings.clientId)

        if self.driver_settings.username:
            self.client.username_pw_set(
                self.driver_settings.username,
                self.driver_settings.password,
            )

        if self.driver_settings.useTls:
            cert_reqs = (
                ssl.CERT_NONE
                if self.driver_settings.acceptSelfSignedCert
                else ssl.CERT_REQUIRED
            )
            self.client.tls_set(cert_reqs=cert_reqs)
            self.client.tls_insecure_set(self.driver_settings.acceptSelfSignedCert)

        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message
        if hasattr(self.client, "on_connect_fail"):
            self.client.on_connect_fail = self._on_connect_fail

        self.client.loop_start()
        self.client.connect_async(
            self.driver_settings.hostname,
            int(self.driver_settings.port),
            keepalive=30,
        )
        await asyncio.wait_for(self.connected_event.wait(), timeout=30)

        if self.connect_error is not None:
            raise self.connect_error

    async def disconnect(self) -> None:
        if self.client is None:
            return

        client = self.client
        self.client = None
        client.disconnect()
        client.loop_stop()
        self.emit("disconnect")

    async def subscribe(self, topic: str) -> None:
        if self.client is None:
            raise RuntimeError("MQTT client is not connected")

        result, _mid = self.client.subscribe(topic)
        if result != 0:
            raise RuntimeError(f"Failed to subscribe to topic {topic} with result {result}")
        self.homey.log(f"Custom MQTT subscribed to topic: {topic}")

    async def unsubscribe(self, topic: str) -> None:
        if self.client is None:
            return

        result, _mid = self.client.unsubscribe(topic)
        if result != 0:
            raise RuntimeError(
                f"Failed to unsubscribe from topic {topic} with result {result}"
            )
        self.homey.log(f"Custom MQTT unsubscribed from topic: {topic}")

    async def discover_devices(
        self,
        topic: str,
        timeout: int = 20_000,
    ) -> list[DiscoveredDevice]:
        devices: dict[str, DiscoveredDevice] = {}

        def on_message(received_topic: str, _message: Any) -> None:
            device_id = _extract_device_id(received_topic)
            if not device_id or device_id in devices:
                return

            devices[device_id] = DiscoveredDevice(
                id=device_id,
                name=f"Watts Live - {device_id}",
                data={"id": device_id},
                settings={"deviceId": device_id},
            )

        self.homey.log(f"Starting custom MQTT discovery on topic: {topic}")
        self.on("message", on_message)
        await self.subscribe(topic)
        try:
            await asyncio.sleep(timeout / 1000)
        finally:
            self.off("message", on_message)
            await self.unsubscribe(topic)

        self.homey.log(f"Custom MQTT discovery complete. Devices found: {len(devices)}")
        return list(devices.values())

    def _on_connect(
        self,
        _client: Any,
        _userdata: Any,
        _flags: Any,
        reason_code: Any,
        _properties: Any = None,
    ) -> None:
        code = getattr(reason_code, "value", reason_code)
        if code != 0:
            error = RuntimeError(f"MQTT connect failed with code {code}")
            self.connect_error = error
            if self.loop is not None and self.connected_event is not None:
                self.loop.call_soon_threadsafe(self.connected_event.set)
            self._emit_on_loop("error", error)
            return

        if self.loop is not None and self.connected_event is not None:
            self.loop.call_soon_threadsafe(self.connected_event.set)
        self._emit_on_loop("connect")

    def _on_connect_fail(self, _client: Any, _userdata: Any) -> None:
        error = RuntimeError("MQTT connection failed before CONNACK")
        self.connect_error = error
        if self.loop is not None and self.connected_event is not None:
            self.loop.call_soon_threadsafe(self.connected_event.set)
        self._emit_on_loop("error", error)

    def _on_disconnect(
        self,
        _client: Any,
        _userdata: Any,
        _flags: Any,
        reason_code: Any,
        _properties: Any = None,
    ) -> None:
        code = getattr(reason_code, "value", reason_code)
        if code != 0:
            self._emit_on_loop("error", RuntimeError(f"MQTT disconnected with code {code}"))
        self._emit_on_loop("disconnect")

    def _on_message(self, _client: Any, _userdata: Any, message: Any) -> None:
        payload = message.payload.decode("utf-8", errors="ignore")
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            parsed = payload
        self._emit_on_loop("message", message.topic, parsed)


class MqttWrapper(EventEmitter):
    def __init__(self, homey: Any, settings: DriverSettings) -> None:
        super().__init__()
        self.homey = homey
        self.settings = settings
        self.connector: HomeyMqttConnector | CustomMqttConnector | None = None
        self.subscribed_topics: list[str] = []

    def _ensure_connector(self) -> HomeyMqttConnector | CustomMqttConnector:
        if self.connector is None:
            if self.settings.useHomeyMqttClient == "homey":
                self.connector = HomeyMqttConnector(self.homey)
            else:
                self.connector = CustomMqttConnector(self.homey, self.settings)

            self.connector.on("connect", lambda: self.emit("connect"))
            self.connector.on("disconnect", lambda: self.emit("disconnect"))
            self.connector.on("error", lambda error: self.emit("error", error))
            self.connector.on(
                "message",
                lambda topic, message: self.emit("message", topic, message),
            )

        return self.connector

    async def connect(self) -> None:
        await self._ensure_connector().connect()

    async def disconnect(self) -> None:
        if self.connector is None:
            return

        for topic in list(self.subscribed_topics):
            await self.unsubscribe(topic)

        await self.connector.disconnect()
        self.connector = None
        self.subscribed_topics = []

    async def subscribe(self, topic: str) -> None:
        connector = self._ensure_connector()
        if topic in self.subscribed_topics:
            return
        await connector.subscribe(topic)
        self.subscribed_topics.append(topic)

    async def unsubscribe(self, topic: str) -> None:
        if self.connector is None or topic not in self.subscribed_topics:
            return
        await self.connector.unsubscribe(topic)
        self.subscribed_topics = [current for current in self.subscribed_topics if current != topic]

    async def discover_devices(
        self,
        topic: str,
        timeout: int = 10_000,
    ) -> list[DiscoveredDevice]:
        return await self._ensure_connector().discover_devices(topic, timeout)


def _extract_device_id(topic: str) -> str | None:
    parts = topic.strip("/").split("/")
    if len(parts) == 3 and parts[0] == "watts" and parts[2] == "measurement":
        return parts[1]
    return None
