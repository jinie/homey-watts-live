from collections import defaultdict
from typing import Any, Callable


class EventEmitter:
    def __init__(self) -> None:
        self._listeners: dict[str, list[Callable[..., Any]]] = defaultdict(list)

    def on(self, event: str, callback: Callable[..., Any]) -> None:
        self._listeners[event].append(callback)

    def off(self, event: str, callback: Callable[..., Any]) -> None:
        listeners = self._listeners.get(event, [])
        if callback in listeners:
            listeners.remove(callback)

    def remove_listener(self, event: str, callback: Callable[..., Any]) -> None:
        self.off(event, callback)

    def emit(self, event: str, *args: Any) -> None:
        for callback in list(self._listeners.get(event, [])):
            callback(*args)
