# Watts Live

This lightweight Homey device application adds support through MQTT protocol for Watts Live energy meters.

## Connection types

Choose the connection type when adding a device (it can be changed later in the device settings):

| Connection type | What you need |
|---|---|
| **Built-in MQTT broker** | Nothing else. The app runs its own MQTT broker on Homey (default port 1883, optional login) and Watts Live publishes directly to it. Turn it on in the app settings, or choose it while pairing. |
| **Homey MQTT Client** | Menno van Grinsven's MQTT Client app, installed and connected to the broker Watts Live publishes to. |
| **Custom MQTT server** | Your own broker (e.g. Mosquitto). Host, port, login and TLS are entered during pairing. |

Watts Live publishes to `watts/<serial number>/measurement`.

### Configuring Watts Live for the built-in broker

MQTT is configured over Bluetooth with the free app **nRF Connect for Mobile** (see Watts' guide
[Brug Watts Live sammen med Home Assistant](https://watts.zendesk.com/hc/da/articles/10271861655580-Brug-Watts-Live-sammen-med-Home-Assistant)).
Write the Homey IP address to *Hostname*, the port (1883) to *Port*, `00` (TCP) to *Transport* and, if a login is set in the app settings,
the same *Username* and *Password*. Restart the module afterwards. The full step-by-step guide is on the **Help** tab of the app settings,
and the **Status** tab shows the meters that have published to Homey.

## Capabilities

- Power import (`measure_power`) and export (`measure_power.negative_active`), total and per phase
- Net power (`measure_power.net`, `measure_power.net_l1..l3`): import minus export, negative while exporting
- Voltage, current and frequency per phase
- Imported and exported energy (`meter_power.imported` / `meter_power.exported`, used by Homey Energy)
- Reactive power and energy, net reactive power (`measure_power.reactive`) and power factor (`measure_power_factor`)

## Flow cards

- **When** a measurement was received (tokens: power, export, net power, imported and exported energy)
- **When** no data has been received for *N* minutes (fires once per silence)
- **And** data has / has not been received in the last *N* minutes

The device is marked unavailable after 5 minutes without data and becomes available again with the next measurement.
