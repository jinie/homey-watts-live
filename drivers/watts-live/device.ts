'use strict';

import Homey from 'homey';
import {
  ReadingToCapabilityMap,
  addedCapabilitiesV1toV2,
  removedCapabilitiesV1toV2,
} from '../../lib/constants';
import DriverSettings from '../../types/DriverSettings';
import MqttWrapper from '../../lib/MqttWrapper';
import KvMap from '../../types/KvMap';
import MeterReading from '../../types/MeterReading';

export default class WattsLiveDevice extends Homey.Device {

  private readonly debug: boolean = process.env.DEBUG !== undefined;
  private mqttWrapper: MqttWrapper | null = null;


  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    await this.migrateToNewMqttConnectivity();
    await this.migrateCapabilities(); // Update capabilities from V1 to V2

    // Get device-specific settings and create a DriverSettings object
    const driverSettings = this.getDeviceSettings();

    this.homey.log(
      `Initializing Device with settings : ${driverSettings.toSafeJSON()}`,
    );
    // Initialize the MQTT wrapper with the device's settings

    try {
      await this.reconnectMqtt();


      if (!this.mqttWrapper) {
        throw new Error('MQTT wrapper is not initialized');
      } else {
        this.mqttWrapper.on('connect', () => {
          this.setAvailable().catch(() => {});
        });
        this.mqttWrapper.on('disconnect',() => {
          this.setUnavailable().catch(() => {});
        })
      }
    } catch (err: any) {
      this.homey.log(err);
      throw err;
    }

    process.on('unhandledRejection', (reason, p) => {
      this.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    });
  }


  async onMessage(topic: string, message: any) {
    this.log(`onMessage: Message received on topic ${topic}: ${message}`);
    await this.processMqttMessage(topic, message);
  }

  /**
   * Called when the device is deleted from Homey.
   */
  async onDeleted(): Promise<void> {
    // Perform cleanup by disconnecting MQTT and freeing any resources.
    return new Promise((resolve, reject) => {
      if (this.mqttWrapper) {
        this.mqttWrapper.disconnect().then(() => {
          resolve()
        }).catch(() => {
          reject()
        });
      }
    });
  }

  /**
   * Called when the device is added to Homey.
   */
  async onAdded(): Promise<void> {
    // This is where you can implement any setup logic after the device is paired or added.
    // For example, sending an MQTT message to let the server know this device was added
    const { deviceId } = this.getDeviceSettings();
    this.log(`Device added: ${deviceId}`);
    // Optionally: Publish an MQTT message or perform any initialization specific to being added.
    await this.setAvailable();
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('WattsLiveDevice was renamed');
  }

  /**
   * Utility function to get device settings and return a DriverSettings object.
   */
  getDeviceSettings(): DriverSettings {
    const settings = this.getSettings();
    if (this.debug) {
      this.log(`Reading device settings ${JSON.stringify(settings)}`);
    }
    // Construct and return a DriverSettings object using the device's settings
    const newSettings = new DriverSettings(settings);
    return newSettings;
  }

  public async processMqttMessage(topic: string, message: any) {
    let msg: object = {};
    if (typeof message === typeof Buffer) {
      msg = JSON.parse(message.toString());
    } else if (typeof message === typeof String) {
      msg = JSON.parse(message as string);
    } else {
      msg = message;
    }

    if(msg === null) {
      this.log(`Message converted to null : ${message}`)
      return;
    }
    try {
      // Extract device id from topic where device id is /watts/<device_id>/measurement
      const readings: MeterReading = new MeterReading(msg);
      if (this.debug) {
        this.log(
          `processMqttMessage: received reading ${JSON.stringify(readings)}`,
        );
      }
      // Map readings to capabilities, convert undefined to 0
      const kMap: KvMap = {};
      Object.keys(ReadingToCapabilityMap).forEach((value) => {
        const key = ReadingToCapabilityMap[value];
        kMap[key] = readings[value as unknown as keyof MeterReading] ?? 0;
        // Convert from Watts to kW
        if (
          [
            'meter_power.imported',
            'meter_power.exported',
            'meter_power.negative_reactive',
            'meter_power.positive_reactive',
          ].includes(key)
        ) {
          kMap[key] = (kMap[key] ?? 0) / 1000;
        }
      });

      // Set capabilities
      Object.keys(kMap).forEach((key) => {
        if (this.hasCapability(key) && kMap[key] !== undefined) {
          this.setCapabilityValue(key, kMap[key] as number).catch(() => { });
        } else {
          this.log(`processMqttMessage: unknown capability ${key}`);
        }
      });
    } catch (error: any) {
      if (this.debug) throw error;
      else this.log(`processMqttMessage error: ${error}`);
    }
  }

  /**
   * Called when settings are changed via the Homey UI.
   * This method handles changes to settings and updates the device configuration accordingly.
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: {
      [key: string]: string | number | boolean | null | undefined;
    };
    newSettings: {
      [key: string]: string | number | boolean | null | undefined;
    };
    changedKeys: string[];
  }): Promise<void> {
    this.log('Settings updated:', changedKeys);

    // Check if any MQTT-related settings have changed that require reconnecting
    const needsReconnect = changedKeys.some((key) =>
      [
        'hostname',
        'port',
        'clientId',
        'username',
        'password',
        'useTls',
        'useHomeyMqttClient',
        'deviceId',
      ].includes(key),
    );

    if (needsReconnect) {
      try {
        this.log('Reconnecting due to changed MQTT settings...');
        const driverSettings = new DriverSettings(newSettings);
        await this.reconnectMqtt(driverSettings);
      } catch (ex: any) {
        this.log('Error reconnecting: ', ex);
        await this.reconnectMqtt(new DriverSettings(oldSettings));
        throw ex;
      }
    }
  }

  getMqttTopic() {
    return this.getSettings()['deviceId'];
  }


  /**
   * Invalidate the device status, typically when the connection is lost or an error occurs.
   */
  invalidateStatus(): void {
    this.log('Device status invalidated');
    this.setUnavailable('Device disconnected or unavailable').catch(() => {});
  }

  /**
   * Helper method to reconnect the device to the MQTT server.
   * Handles disconnection and reconnection logic.
   */
  private async reconnectMqtt(newSettings?: DriverSettings): Promise<void> {
    await this.mqttWrapper?.disconnect();

    // Use new settings if provided, otherwise use current device settings
    const driverSettings = newSettings || this.getDeviceSettings();

    // Reinitialize the MQTT wrapper with the new settings
    const homeyApp = this.homey;
    this.mqttWrapper = new MqttWrapper(homeyApp, driverSettings);
    await this.mqttWrapper.connect().then(() => {
      // Re-subscribe to the device's topic
      const { deviceId } = this.getDeviceSettings();
      this.mqttWrapper?.subscribe(
        `watts/${deviceId}/measurement`,
      ).then(() => {
        this.mqttWrapper?.on('message', (topic: string, message: any) => {
          this.onMessage(topic, message).catch((ex) => { throw ex });
        });
        this.setAvailable().catch((ex) => { throw ex });
      }).catch(() => { });
    }).catch(() => {
      this.setUnavailable().catch((ex) => { throw ex });
    });
  }

  /**
   * Migrate V1 devices to new V2 connectivity
   */
  async migrateToNewMqttConnectivity(): Promise<void> {
    try {
      // Get the current settings of the device
      const settings = this.getSettings();

      // Check if the `useHomeyMqttClient` key is missing, indicating the old format
      if (!settings.useHomeyMqttClient) {
        this.log(
          `Migrating device ${this.getSetting('deviceId')} to the new MQTT connectivity...`,
        );

        const newSettings = DriverSettings.driverSettingsDefault(
          this.getSetting('deviceId'),
        );

        // Apply the new settings to the device
        await this.setSettings(newSettings);

        this.log(
          `Device ${this.getSetting('deviceId')} successfully migrated to the new MQTT connectivity.`,
        );
      } else {
        this.log(
          `Device ${this.getSetting('deviceId')} is already using the new MQTT connectivity.`,
        );
      }
    } catch (error) {
      this.error(`Error migrating device ${this.getData().id}:`, error);
    }
  }

  /**
   * Migrate custom capabilities between versions.
   * No 'official' way of migrating exists, so for now just delete the old capabiliy and add a new one.
   * This deletes history and may break flows, so don't make a habit of it.
   */
  async migrateCapabilities() {
    if (this.getCapabilities().includes('meter_power')) {
      this.log('Removing meter_power capability');
      await this.removeCapability('meter_power').catch((error) => {
        if (this.debug) throw error;
        else this.log(`migrateCapabilites, removeCapability error: ${error}`);
      });
      this.log('Adding meter_power.imported capability');
      await this.addCapability('meter_power.imported').catch((error) => {
        if (this.debug) throw error;
        else this.log(`migrateCapabilites, addCapability error: ${error}`);
      });
    }
    if (this.getCapabilities().includes('measure_negative_active_energy')) {
      this.log('removing measure_negative_active_energy capability');
      await this.removeCapability('measure_negative_active_energy').catch(
        (error) => {
          if (this.debug) throw error;
          else this.log(`migrateCapabilites, removeCapability error: ${error}`);
        },
      );
      this.log('Adding metwer_power.exported capability');
      await this.addCapability('meter_power.exported').catch((error) => {
        if (this.debug) throw error;
        else this.log(`migrateCapabilites, addCapability error: ${error}`);
      });
    }

    for (const capability of removedCapabilitiesV1toV2) {
      if (this.getCapabilities().includes(capability)) {
        this.log(`Removing capability ${capability}`);
      }

      try {
        await this.removeCapability(capability);
      } catch (error) {
        if (this.debug) {
          throw error;
        } else {
          this.log(`migrateCapabilites, removeCapability error: ${error}`);
        }
      }
    }

    for (const capability of addedCapabilitiesV1toV2) {
      if (!this.getCapabilities().includes(capability)) {
        this.log(`Adding capability ${capability}`);
      }

      try {
        await this.addCapability(capability);
      } catch (error) {
        if (this.debug) {
          throw error;
        } else {
          this.log(
            `migrateCapabilites, Production addCapability error: ${error}`,
          );
        }
      }
    }
  }
}

module.exports = WattsLiveDevice;
