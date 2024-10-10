import Homey from 'homey';
import { DriverSettings } from '../../types/DriverSettings';
import { MqttWrapper } from '../../lib/MqttWrapper';

class WattsLiveDriver extends Homey.Driver {
  private mqttWrapper: MqttWrapper | null = null;

  /**
   * Called when pairing starts.
   */
  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    // Set up the step to ask for MQTT connection method (Homey MQTT Client or Custom MQTT Client)
    session.setHandler('choose_mqtt_method', async (data) => {
      // Based on the user's selection, set up the MQTT connection for scanning
      const settings = this.createDriverSettingsFromData(data);
      const homeyApp = this.homey;

      this.mqttWrapper = new MqttWrapper(homeyApp,settings);
      await this.mqttWrapper.connect();

      // Return available devices to continue the pairing process
      return await this.scanForDevices();
    });

    // Set up the step for the user to select devices from the available list
    session.setHandler('list_devices', async (data) => {
      const availableDevices = await this.scanForDevices();
      return availableDevices.map((device) => ({
        name: device.name,
        data: {
          id: device.id,
        },
      }));
    });

    // Store the selected devices and their MQTT connection information
    session.setHandler('store_settings', async (data) => {
      const devices = data.selectedDevices;
      const settings = this.createDriverSettingsFromData(data.mqttSettings);

      devices.forEach(async (device:any) => {
        const deviceObj = await this.getDevice(device.id);
        if (deviceObj) {
          // Store the settings (including MQTT settings) on each individual device
          await deviceObj.setSettings({
            ...settings, // Spread the MQTT settings
            deviceId: device.id,
          });
        }
      });
    });
  }

  /**
   * Helper method to scan for devices using MQTT
   * This method returns devices that are not already present.
   */
  private async scanForDevices(): Promise<any[]> {
    const existingDevices = this.getDevices();
    const existingDeviceIds = existingDevices.map((device) => device.getData().id);

    const availableDevices: any[] = [];

    // Subscribe to the MQTT topic to discover devices
    this.mqttWrapper?.subscribe('/watts/+/measurement', (topic, message) => {
      const deviceId = topic.split('/')[2]; // Extract deviceId from topic
      if (!existingDeviceIds.includes(deviceId)) {
        availableDevices.push({ id: deviceId, name: `Device ${deviceId}` });
      }
    });

    // You may want to wait for some time to gather all the devices
    await new Promise(resolve => setTimeout(resolve, 2000)); // For example, wait 2 seconds for devices

    return availableDevices;
  }

  /**
   * Helper method to create a DriverSettings object from the pairing data.
   */
  private createDriverSettingsFromData(data: any): DriverSettings {
    return new DriverSettings({
      hostname: data.hostname || 'localhost',
      port: Number(data.port) || 1883,
      clientId: data.clientId || 'homey-watts',
      username: data.username || '',
      password: data.password || '',
      useTls: data.useTls === 'true',
      useHomeyMqttClient: data.useHomeyMqttClient || 'homey',
    });
  }
}

module.exports = WattsLiveDriver;
