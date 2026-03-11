import os
from homey import app as homey_app


class App(homey_app.App):
    async def on_init(self) -> None:
        if hasattr(super(), "on_init"):
            await super().on_init()
        self.application_version = os.getenv("HOMEY_APP_VERSION")
        self.debug = os.getenv("DEBUG") in {"1", "true", "True"}
        self.application_name = "Watts Live MQTT"
        self.log("Watts Live Python app initialized")


homey_export = App
