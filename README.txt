This lightweight Homey device application adds support through MQTT protocol for Watts Live energy meters.

There are three ways to receive the measurements:
- Built-in MQTT broker: Watts Live sends directly to Homey. No other app or MQTT broker is needed. Turn it on in the app settings or choose it when adding a device.
- Menno van Grinsven's MQTT Client app, which must already be installed and configured.
- Your own MQTT broker, specified while pairing.

The device shows power, voltage and current per phase, imported and exported energy (Homey Energy), net power (negative while exporting), reactive power and power factor.

Flow cards: a measurement was received, no data received for a number of minutes, and data has/has not been received in the last minutes.

The app settings contain the status of the built-in broker and a step-by-step guide for configuring the Watts Live module with the nRF Connect app.
