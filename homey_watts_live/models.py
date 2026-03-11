from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class DriverSettings:
    deviceId: str = ""
    hostname: str = "localhost"
    port: int = 1883
    clientId: str = "homey-watts"
    username: str = ""
    password: str = ""
    useTls: bool = False
    useHomeyMqttClient: str = "homey"
    useCustomMqttClient: bool = False
    acceptSelfSignedCert: bool = False

    def __init__(self, settings: dict[str, Any] | "DriverSettings" | None = None) -> None:
        if settings is None:
            return
        source = settings if isinstance(settings, dict) else settings.__dict__
        for key, value in source.items():
            if hasattr(self, key):
                setattr(self, key, value)

        if "useCustomMqttClient" in source:
            self.useCustomMqttClient = bool(source["useCustomMqttClient"])
            self.useHomeyMqttClient = (
                "custom" if self.useCustomMqttClient else "homey"
            )
        else:
            self.useCustomMqttClient = self.useHomeyMqttClient == "custom"

    def to_safe_json(self) -> str:
        safe = self.to_safe_dict()
        return str(safe)

    def to_safe_dict(self) -> dict[str, Any]:
        safe = dict(self.__dict__)
        safe["username"] = "*" * len(self.username) if self.username else ""
        safe["password"] = "*" * len(self.password) if self.password else ""
        return safe

    @classmethod
    def driver_settings_default(cls, device_id: str) -> "DriverSettings":
        return cls({"deviceId": device_id})


@dataclass
class DiscoveredDevice:
    id: str
    name: str
    data: dict[str, str]
    settings: dict[str, Any]


@dataclass
class MeterReading:
    values: dict[str, float] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "MeterReading":
        normalized: dict[str, float] = {}
        for key, value in payload.items():
            if isinstance(value, (int, float)):
                normalized[key] = float(value)
        return cls(values=normalized)
