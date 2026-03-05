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
  private runtimeDebug: boolean = false;
  private settingsDebug: boolean = false;
  private mqttWrapper: MqttWrapper | null = null;
  private logBufferWritePromise: Promise<void> = Promise.resolve();
  private readonly maxDebugLogLines: number = 100;
  private debugLogLines: string[] = [];
  private lastDebugLogPersistAt: number = 0;
  private readonly debugLogPersistIntervalMs: number = 5 * 1000;
  private isHandlingSettings: boolean = false;
  private pendingDebugLogPersist: boolean = false;
  private scheduledDebugPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private messageCount: number = 0;
  private readonly heartbeatIntervalMessages: number = 50;
  private readonly debugLogFlushEveryMessages: number = 10;

  private isRuntimeDebugEnabled(): boolean {
    return process.env.DEBUG === '1' || process.env.DEBUG === 'true';
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    await this.migrateToNewMqttConnectivity();
    await this.migrateCapabilities(); // Update capabilities from V1 to V2
    this.runtimeDebug = this.isRuntimeDebugEnabled();
    this.settingsDebug = this.getSetting('debugLogging') === true;
    const existingDebugLog = this.getSetting('debugLog');
    if (typeof existingDebugLog === 'string' && existingDebugLog.length > 0) {
      this.debugLogLines = existingDebugLog.split('\n').slice(-this.maxDebugLogLines);
    }
    await this.appendDebugLog('Device initialized');

    // Get device-specific settings and create a DriverSettings object
    const driverSettings = this.getDeviceSettings();

    this.homey.log(
      `Initializing Device with settings : ${driverSettings.toSafeJSON()}`,
    );
    // Initialize the MQTT wrapper with the device's settings

    try {
      await this.reconnectMqtt();
    } catch (err: any) {
      this.homey.log(err);
      await this.appendDebugLog(
        `Initial MQTT connection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  private async appendDebugLog(message: string): Promise<void> {
    if (!this.settingsDebug) {
      return;
    }
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    this.debugLogLines.push(logEntry);
    this.debugLogLines = this.debugLogLines.slice(-this.maxDebugLogLines);
    await this.persistDebugLog(false);
  }

  private async persistDebugLog(force: boolean): Promise<void> {
    if (this.isHandlingSettings) {
      this.pendingDebugLogPersist = true;
      return;
    }

    const now = Date.now();
    if (!force && (now - this.lastDebugLogPersistAt) < this.debugLogPersistIntervalMs) {
      return;
    }

    this.logBufferWritePromise = this.logBufferWritePromise.then(async () => {
      await this.setSettings({
        debugLog: this.debugLogLines.join('\n'),
      });
      this.lastDebugLogPersistAt = Date.now();
    }).catch((error) => {
      this.homey.error('Failed to persist debug log', error);
    });
    await this.logBufferWritePromise;
  }

  private scheduleDebugLogPersist(force: boolean): void {
    if (this.scheduledDebugPersistTimer) {
      clearTimeout(this.scheduledDebugPersistTimer);
    }
    this.scheduledDebugPersistTimer = setTimeout(() => {
      this.scheduledDebugPersistTimer = null;
      this.persistDebugLog(force).catch((error) => {
        this.homey.error('Deferred debug log persist failed', error);
      });
    }, 0);
  }

  async onMessage(topic: string, message: unknown) {
    this.messageCount += 1;
    if (!this.runtimeDebug && this.messageCount % this.heartbeatIntervalMessages === 0) {
      this.log(`MQTT heartbeat: processed ${this.messageCount} messages`);
    }
    if (this.runtimeDebug) {
      this.log(`onMessage: Message received on topic ${topic}: ${message}`);
    }
    await this.processMqttMessage(topic, message);
    if (this.settingsDebug && this.messageCount % this.debugLogFlushEveryMessages === 0) {
      this.scheduleDebugLogPersist(true);
    }
  }

  /**
   * Called when the device is deleted from Homey.
   */
  async onDeleted(): Promise<void> {
    // Perform cleanup by disconnecting MQTT and freeing any resources.
    if (!this.mqttWrapper) {
      return;
    }

    await this.appendDebugLog('Device deleted; disconnecting MQTT');
    await this.persistDebugLog(true);
    await this.mqttWrapper.disconnect();
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
    await this.appendDebugLog(`Device added: ${deviceId}`);
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('WattsLiveDevice was renamed');
    await this.appendDebugLog(`Device renamed: ${name}`);
  }

  /**
   * Utility function to get device settings and return a DriverSettings object.
   */
  getDeviceSettings(): DriverSettings {
    const settings = this.getSettings();
    const newSettings = new DriverSettings(settings);
    if (this.runtimeDebug) {
      this.log(`Reading device settings ${newSettings.toSafeJSON()}`);
    }
    // Construct and return a DriverSettings object using the device's settings
    return newSettings;
  }

  public async processMqttMessage(topic: string, message: unknown) {
    let msg: object = {};
    if (Buffer.isBuffer(message)) {
      msg = JSON.parse(message.toString());
    } else if (typeof message === 'string') {
      msg = JSON.parse(message);
    } else if (message && typeof message === 'object') {
      msg = message;
    } else {
      this.log(`Skipping unsupported MQTT message type on ${topic}`);
      return;
    }

    if (msg === null) {
      this.log(`Message converted to null : ${message}`);
      return;
    }
    try {
      // Extract device id from topic where device id is /watts/<device_id>/measurement
      const readings: MeterReading = new MeterReading(msg);
      if (this.runtimeDebug) {
        this.log(
          `processMqttMessage: received reading ${JSON.stringify(readings)}`,
        );
      }
      if (this.settingsDebug) {
        await this.appendDebugLog(
          `processMqttMessage: received reading ${JSON.stringify(readings)}`,
        );
      }
      // Map readings to capabilities, convert undefined to 0
      const kMap: KvMap = {};
      Object.keys(ReadingToCapabilityMap).forEach((value) => {
        const key = ReadingToCapabilityMap[value];
        const reading = readings[value as unknown as keyof MeterReading];
        if (reading === undefined || reading === null) {
          return;
        }
        kMap[key] = reading;
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
      const capabilityUpdates: Array<Promise<void>> = [];
      Object.keys(kMap).forEach((key) => {
        if (this.hasCapability(key) && kMap[key] !== undefined) {
          const currentValue = this.getCapabilityValue(key);
          if (currentValue === kMap[key]) {
            return;
          }
          capabilityUpdates.push(this.setCapabilityValue(key, kMap[key] as number));
        } else {
          this.log(`processMqttMessage: unknown capability ${key}`);
        }
      });

      if (capabilityUpdates.length > 0) {
        const updateResults = await Promise.allSettled(capabilityUpdates);
        if (this.runtimeDebug) {
          updateResults.forEach((result, idx) => {
            if (result.status === 'rejected') {
              this.log(`setCapabilityValue failed at index ${idx}: ${result.reason}`);
            }
          });
        }
      }
    } catch (error: unknown) {
      if (this.runtimeDebug) throw error;
      else this.log(`processMqttMessage error: ${error instanceof Error ? error.message : String(error)}`);
      await this.appendDebugLog(
        `processMqttMessage error on ${topic}: ${error instanceof Error ? error.message : String(error)}`,
      );
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
    if (changedKeys.length === 1 && changedKeys[0] === 'debugLog') {
      return;
    }
    this.isHandlingSettings = true;
    try {
      this.log('Settings updated:', changedKeys);
      const nextSettingsDebug = newSettings.debugLogging === true;
      const wasSettingsDebug = this.settingsDebug;
      if (!wasSettingsDebug && nextSettingsDebug) {
        this.settingsDebug = true;
        await this.appendDebugLog('Debug logging enabled');
      } else if (wasSettingsDebug && !nextSettingsDebug) {
        await this.appendDebugLog('Debug logging disabled');
        this.settingsDebug = false;
      } else {
        this.settingsDebug = nextSettingsDebug;
      }
      await this.appendDebugLog(`Settings updated: ${changedKeys.join(', ')}`);
      if (changedKeys.includes('debugLogging')) {
        this.pendingDebugLogPersist = true;
      }

      // Check if any MQTT-related settings have changed that require reconnecting
      const needsReconnect = changedKeys.some((key) => [
        'hostname',
        'port',
        'clientId',
        'username',
        'password',
        'useTls',
        'useHomeyMqttClient',
        'deviceId',
      ].includes(key));

      if (needsReconnect) {
        try {
          this.log('Reconnecting due to changed MQTT settings...');
          await this.appendDebugLog('Reconnecting due to MQTT setting changes');
          const driverSettings = new DriverSettings(newSettings);
          await this.reconnectMqtt(driverSettings);
        } catch (ex: any) {
          this.log('Error reconnecting: ', ex);
          await this.appendDebugLog(
            `Reconnect failed; restoring previous settings: ${ex instanceof Error ? ex.message : String(ex)}`,
          );
          await this.reconnectMqtt(new DriverSettings(oldSettings));
          throw ex;
        }
      }
    } finally {
      this.isHandlingSettings = false;
    }

    if (this.pendingDebugLogPersist) {
      this.pendingDebugLogPersist = false;
      this.scheduleDebugLogPersist(true);
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
    if (this.mqttWrapper) {
      await this.mqttWrapper.disconnect().catch((error) => {
        this.homey.error(error);
      });
      await this.appendDebugLog('Disconnected previous MQTT wrapper');
    }

    // Use new settings if provided, otherwise use current device settings
    const driverSettings = newSettings || this.getDeviceSettings();

    // Reinitialize the MQTT wrapper with the new settings
    const homeyApp = this.homey;
    const mqttWrapper = new MqttWrapper(homeyApp, driverSettings);
    this.mqttWrapper = mqttWrapper;

    mqttWrapper.on('disconnect', () => {
      this.setUnavailable().catch(() => {});
      this.appendDebugLog('MQTT disconnect event received').catch(() => {});
    });

    mqttWrapper.on('message', (topic: string, message: unknown) => {
      this.onMessage(topic, message).catch((error) => {
        this.homey.error(`Error handling message on topic ${topic}`, error);
      });
    });

    await mqttWrapper.connect();
    this.homey.log('MQTT connect signal received');
    await this.appendDebugLog('MQTT connected');
    await mqttWrapper.subscribe(`watts/${driverSettings.deviceId}/measurement`);
    await this.appendDebugLog(`Subscribed to watts/${driverSettings.deviceId}/measurement`);
    await this.setAvailable();
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
        if (this.runtimeDebug) throw error;
        else this.log(`migrateCapabilites, removeCapability error: ${error}`);
      });
      this.log('Adding meter_power.imported capability');
      await this.addCapability('meter_power.imported').catch((error) => {
        if (this.runtimeDebug) throw error;
        else this.log(`migrateCapabilites, addCapability error: ${error}`);
      });
    }
    if (this.getCapabilities().includes('measure_negative_active_energy')) {
      this.log('removing measure_negative_active_energy capability');
      await this.removeCapability('measure_negative_active_energy').catch(
        (error) => {
          if (this.runtimeDebug) throw error;
          else this.log(`migrateCapabilites, removeCapability error: ${error}`);
        },
      );
      this.log('Adding metwer_power.exported capability');
      await this.addCapability('meter_power.exported').catch((error) => {
        if (this.runtimeDebug) throw error;
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
        if (this.runtimeDebug) {
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
        if (this.runtimeDebug) {
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
