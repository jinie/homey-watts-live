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
import DebugLogLevel from '../../types/DebugLogLevel';

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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt: number = 0;
  private isReconnectInProgress: boolean = false;
  private isDeleted: boolean = false;

  private isRuntimeDebugEnabled(): boolean {
    return process.env.DEBUG === '1' || process.env.DEBUG === 'true';
  }

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.isDeleted = false;
    await this.migrateToNewMqttConnectivity();
    await this.migrateCapabilities(); // Update capabilities from V1 to V2
    this.runtimeDebug = this.isRuntimeDebugEnabled();
    this.settingsDebug = this.getSetting('debugLogging') === true;
    const existingDebugLog = this.getSetting('debugLog');
    if (typeof existingDebugLog === 'string' && existingDebugLog.length > 0) {
      this.debugLogLines = existingDebugLog.split('\n').slice(-this.maxDebugLogLines);
    }
    await this.logMessage(DebugLogLevel.INFO, 'Device initialized');

    // Get device-specific settings and create a DriverSettings object
    const driverSettings = this.getDeviceSettings();

    await this.logMessage(
      DebugLogLevel.INFO,
      `Initializing Device with settings : ${driverSettings.toSafeJSON()}`,
      undefined,
      { persistToSettings: false },
    );
    // Initialize the MQTT wrapper with the device's settings

    try {
      await this.reconnectMqtt();
    } catch (err: any) {
      await this.logMessage(
        DebugLogLevel.ERROR,
        'Initial MQTT connection setup failed',
        err,
      );
      this.invalidateStatus(this.getConnectionIssueMessage(err));
      this.scheduleReconnect('initial connection failed');
    }
  }

  private shouldPersistLog(level: DebugLogLevel): boolean {
    return level <= DebugLogLevel.INFO || this.settingsDebug;
  }

  private sanitizeLogText(message: string): string {
    return message
      .replace(
        /("?(?:username|password)"?\s*:\s*")([^"]*)(")/gi,
        '$1***$3',
      )
      .replace(
        /(\b(?:username|password)\b\s*[=:]\s*)([^,\s;]+)/gi,
        '$1***',
      )
      .replace(
        /(mqtts?:\/\/)([^:@/\s]+)(?::[^@/\s]*)?@/gi,
        '$1***:***@',
      );
  }

  private formatLogError(error: unknown): string {
    if (error instanceof Error) {
      const errorDetails = error.stack || error.message || String(error);
      return this.sanitizeLogText(errorDetails);
    }

    return this.sanitizeLogText(String(error));
  }

  private async appendDebugLog(
    message: string,
    level: DebugLogLevel = DebugLogLevel.INFO,
  ): Promise<void> {
    if (!this.shouldPersistLog(level)) {
      return;
    }
    const timestamp = new Date().toISOString();
    const logLevelLabel = DebugLogLevel[level];
    const logEntry = `[${timestamp}] [${logLevelLabel}] ${message}`;
    this.debugLogLines.push(logEntry);
    this.debugLogLines = this.debugLogLines.slice(-this.maxDebugLogLines);
    await this.persistDebugLog(false);
  }

  private async logMessage(
    level: DebugLogLevel,
    message: string,
    error?: unknown,
    options?: {
      persistToSettings?: boolean;
    },
  ): Promise<void> {
    const persistToSettings = options?.persistToSettings ?? true;
    const sanitizedMessage = this.sanitizeLogText(message);
    const sanitizedError = error === undefined ? '' : this.formatLogError(error);
    const combinedMessage = sanitizedError.length > 0
      ? `${sanitizedMessage}: ${sanitizedError}`
      : sanitizedMessage;

    if (level === DebugLogLevel.ERROR) {
      this.homey.error(combinedMessage);
    } else {
      this.homey.log(combinedMessage);
    }

    if (persistToSettings) {
      await this.appendDebugLog(combinedMessage, level);
    }
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
      this.logMessage(
        DebugLogLevel.ERROR,
        'Failed to persist debug log',
        error,
        { persistToSettings: false },
      ).catch(() => {});
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
        this.logMessage(
          DebugLogLevel.ERROR,
          'Deferred debug log persist failed',
          error,
          { persistToSettings: false },
        ).catch(() => {});
      });
    }, 0);
  }

  async onMessage(topic: string, message: unknown) {
    this.messageCount += 1;
    if (!this.runtimeDebug && this.messageCount % this.heartbeatIntervalMessages === 0) {
      this.logMessage(
        DebugLogLevel.INFO,
        `MQTT heartbeat: processed ${this.messageCount} messages`,
      ).catch(() => {});
    }
    if (this.runtimeDebug) {
      this.logMessage(
        DebugLogLevel.DEBUG,
        `onMessage: Message received on topic ${topic}: ${String(message)}`,
      ).catch(() => {});
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
    this.isDeleted = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Perform cleanup by disconnecting MQTT and freeing any resources.
    if (!this.mqttWrapper) {
      return;
    }

    await this.logMessage(DebugLogLevel.INFO, 'Device deleted; disconnecting MQTT');
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
    await this.logMessage(DebugLogLevel.INFO, `Device added: ${deviceId}`);
    // Optionally: Publish an MQTT message or perform any initialization specific to being added.
    await this.setAvailable();
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    await this.logMessage(DebugLogLevel.INFO, 'WattsLiveDevice was renamed');
  }

  /**
   * Utility function to get device settings and return a DriverSettings object.
   */
  getDeviceSettings(): DriverSettings {
    const settings = this.getSettings();
    const newSettings = new DriverSettings(settings);
    if (this.runtimeDebug) {
      this.logMessage(
        DebugLogLevel.DEBUG,
        `Reading device settings ${newSettings.toSafeJSON()}`,
      ).catch(() => {});
    }
    // Construct and return a DriverSettings object using the device's settings
    return newSettings;
  }

  public async processMqttMessage(topic: string, message: unknown) {
    try {
      let msg: object = {};
      if (Buffer.isBuffer(message)) {
        msg = JSON.parse(message.toString());
      } else if (typeof message === 'string') {
        msg = JSON.parse(message);
      } else if (message && typeof message === 'object') {
        msg = message;
      } else {
        await this.logMessage(
          DebugLogLevel.INFO,
          `Skipping unsupported MQTT message type on ${topic}`,
        );
        return;
      }

      if (msg === null) {
        await this.logMessage(
          DebugLogLevel.INFO,
          `Message converted to null: ${String(message)}`,
        );
        return;
      }

      // Extract device id from topic where device id is /watts/<device_id>/measurement
      const readings: MeterReading = new MeterReading(msg);
      this.logMessage(
        DebugLogLevel.DEBUG,
        `processMqttMessage: received reading ${JSON.stringify(readings)}`,
      ).catch(() => {});
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
          this.logMessage(
            DebugLogLevel.DEBUG,
            `processMqttMessage: unknown capability ${key}`,
          ).catch(() => {});
        }
      });

      if (capabilityUpdates.length > 0) {
        const updateResults = await Promise.allSettled(capabilityUpdates);
        if (this.runtimeDebug) {
          updateResults.forEach((result, idx) => {
            if (result.status === 'rejected') {
              this.logMessage(
                DebugLogLevel.DEBUG,
                `setCapabilityValue failed at index ${idx}: ${String(result.reason)}`,
              ).catch(() => {});
            }
          });
        }
      }
    } catch (error: unknown) {
      if (this.runtimeDebug) throw error;
      await this.logMessage(
        DebugLogLevel.ERROR,
        `processMqttMessage error on ${topic}`,
        error,
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
      await this.logMessage(
        DebugLogLevel.INFO,
        `Settings updated: ${changedKeys.join(', ')}`,
      );
      const nextSettingsDebug = newSettings.debugLogging === true;
      const wasSettingsDebug = this.settingsDebug;
      if (!wasSettingsDebug && nextSettingsDebug) {
        this.settingsDebug = true;
        await this.logMessage(DebugLogLevel.INFO, 'Debug logging enabled');
      } else if (wasSettingsDebug && !nextSettingsDebug) {
        await this.logMessage(DebugLogLevel.INFO, 'Debug logging disabled');
        this.settingsDebug = false;
      } else {
        this.settingsDebug = nextSettingsDebug;
      }
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
          await this.logMessage(
            DebugLogLevel.INFO,
            'Reconnecting due to changed MQTT settings',
          );
          const driverSettings = new DriverSettings(newSettings);
          await this.reconnectMqtt(driverSettings);
        } catch (ex: any) {
          await this.logMessage(
            DebugLogLevel.ERROR,
            'Reconnect failed; restoring previous settings',
            ex,
          );
          this.invalidateStatus(this.getConnectionIssueMessage(ex));
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

  private translate(key: string): string {
    return this.homey.__(key);
  }

  private getConnectionIssueMessage(error?: unknown): string {
    const rawMessage = error instanceof Error ? error.message : String(error ?? '');
    const normalizedMessage = rawMessage.toLowerCase();

    if (normalizedMessage.includes('not authorized')) {
      return this.translate('device.unavailable.mqtt_authorization_failed');
    }

    if (normalizedMessage.includes('enotfound') || normalizedMessage.includes('getaddrinfo')) {
      return this.translate('device.unavailable.mqtt_hostname_not_found');
    }

    if (normalizedMessage.includes('econnrefused') || normalizedMessage.includes('connection refused')) {
      return this.translate('device.unavailable.mqtt_connection_refused');
    }

    if (normalizedMessage.includes('timeout')) {
      return this.translate('device.unavailable.mqtt_timeout');
    }

    if (normalizedMessage.length > 0) {
      return `${this.translate('device.unavailable.mqtt_connection_error')}: ${this.sanitizeLogText(rawMessage)}`;
    }

    return this.translate('device.unavailable.mqtt_connection_lost');
  }

  /**
   * Invalidate the device status, typically when the connection is lost or an error occurs.
   */
  invalidateStatus(reason?: string): void {
    const unavailableMessage = reason ?? this.translate('device.unavailable.mqtt_connection_lost');
    this.logMessage(
      DebugLogLevel.INFO,
      `Device status invalidated: ${unavailableMessage}`,
    ).catch(() => {});
    this.setUnavailable(unavailableMessage).catch(() => {});
  }

  private scheduleReconnect(reason: string): void {
    if (this.isDeleted) {
      return;
    }

    if (this.reconnectTimer || this.isReconnectInProgress) {
      return;
    }

    const delayMs = Math.min(30000, 2000 * (2 ** this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.logMessage(
      DebugLogLevel.DEBUG,
      `Scheduling MQTT reconnect in ${delayMs}ms (${reason})`,
    ).catch(() => {});

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectMqtt().catch((error) => {
        this.logMessage(
          DebugLogLevel.ERROR,
          'MQTT reconnect attempt failed',
          error,
        ).catch(() => {});
        this.invalidateStatus(this.getConnectionIssueMessage(error));
        this.scheduleReconnect('retry failed');
      });
    }, delayMs);
  }

  /**
   * Helper method to reconnect the device to the MQTT server.
   * Handles disconnection and reconnection logic.
   */
  private async reconnectMqtt(newSettings?: DriverSettings): Promise<void> {
    if (this.isDeleted) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isReconnectInProgress = true;
    if (this.mqttWrapper) {
      await this.mqttWrapper.disconnect().catch((error) => {
        this.logMessage(
          DebugLogLevel.ERROR,
          'Failed to disconnect previous MQTT wrapper',
          error,
        ).catch(() => {});
      });
      await this.logMessage(
        DebugLogLevel.DEBUG,
        'Disconnected previous MQTT wrapper',
      );
    }

    // Use new settings if provided, otherwise use current device settings
    const driverSettings = newSettings || this.getDeviceSettings();

    // Reinitialize the MQTT wrapper with the new settings
    const homeyApp = this.homey;
    const mqttWrapper = new MqttWrapper(homeyApp, driverSettings);
    this.mqttWrapper = mqttWrapper;

    mqttWrapper.on('connect', () => {
      if (this.mqttWrapper !== mqttWrapper) {
        return;
      }
      this.logMessage(
        DebugLogLevel.DEBUG,
        'MQTT connect event received',
      ).catch(() => {});
    });

    mqttWrapper.on('disconnect', () => {
      if (this.mqttWrapper !== mqttWrapper || this.isDeleted) {
        return;
      }
      this.invalidateStatus(this.translate('device.unavailable.mqtt_disconnected'));
      this.logMessage(
        DebugLogLevel.ERROR,
        'MQTT disconnect event received',
      ).catch(() => {});
      this.scheduleReconnect('disconnect event');
    });

    mqttWrapper.on('error', (error: Error) => {
      if (this.mqttWrapper !== mqttWrapper || this.isDeleted) {
        return;
      }
      this.invalidateStatus(this.getConnectionIssueMessage(error));
      this.logMessage(
        DebugLogLevel.ERROR,
        `MQTT error event received: ${error.message}`,
      ).catch(() => {});
      this.scheduleReconnect(`error event: ${error.message}`);
    });

    mqttWrapper.on('message', (topic: string, message: unknown) => {
      if (this.mqttWrapper !== mqttWrapper) {
        return;
      }
      this.onMessage(topic, message).catch((error) => {
        this.logMessage(
          DebugLogLevel.ERROR,
          `Error handling message on topic ${topic}`,
          error,
        ).catch(() => {});
      });
    });

    try {
      await mqttWrapper.connect();
      await this.logMessage(DebugLogLevel.INFO, 'MQTT connect signal received');
      await this.logMessage(DebugLogLevel.INFO, 'MQTT connected');
      await mqttWrapper.subscribe(`watts/${driverSettings.deviceId}/measurement`);
      await this.logMessage(
        DebugLogLevel.INFO,
        `Subscribed to watts/${driverSettings.deviceId}/measurement`,
      );
      this.reconnectAttempt = 0;
      await this.setAvailable();
    } finally {
      this.isReconnectInProgress = false;
    }
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
        await this.logMessage(
          DebugLogLevel.INFO,
          `Migrating device ${this.getSetting('deviceId')} to the new MQTT connectivity...`,
        );

        const newSettings = DriverSettings.driverSettingsDefault(
          this.getSetting('deviceId'),
        );

        // Apply the new settings to the device
        await this.setSettings(newSettings);

        await this.logMessage(
          DebugLogLevel.INFO,
          `Device ${this.getSetting('deviceId')} successfully migrated to the new MQTT connectivity.`,
        );
      } else {
        await this.logMessage(
          DebugLogLevel.INFO,
          `Device ${this.getSetting('deviceId')} is already using the new MQTT connectivity.`,
        );
      }
    } catch (error) {
      await this.logMessage(
        DebugLogLevel.ERROR,
        `Error migrating device ${this.getData().id}`,
        error,
      );
    }
  }

  /**
   * Migrate custom capabilities between versions.
   * No 'official' way of migrating exists, so for now just delete the old capabiliy and add a new one.
   * This deletes history and may break flows, so don't make a habit of it.
   */
  async migrateCapabilities() {
    if (this.getCapabilities().includes('meter_power')) {
      await this.logMessage(DebugLogLevel.INFO, 'Removing meter_power capability');
      await this.removeCapability('meter_power').catch((error) => {
        if (this.runtimeDebug) throw error;
        else {
          this.logMessage(
            DebugLogLevel.ERROR,
            'migrateCapabilites, removeCapability error',
            error,
          ).catch(() => {});
        }
      });
      await this.logMessage(DebugLogLevel.INFO, 'Adding meter_power.imported capability');
      await this.addCapability('meter_power.imported').catch((error) => {
        if (this.runtimeDebug) throw error;
        else {
          this.logMessage(
            DebugLogLevel.ERROR,
            'migrateCapabilites, addCapability error',
            error,
          ).catch(() => {});
        }
      });
    }
    if (this.getCapabilities().includes('measure_negative_active_energy')) {
      await this.logMessage(DebugLogLevel.INFO, 'Removing measure_negative_active_energy capability');
      await this.removeCapability('measure_negative_active_energy').catch(
        (error) => {
          if (this.runtimeDebug) throw error;
          else {
            this.logMessage(
              DebugLogLevel.ERROR,
              'migrateCapabilites, removeCapability error',
              error,
            ).catch(() => {});
          }
        },
      );
      await this.logMessage(DebugLogLevel.INFO, 'Adding metwer_power.exported capability');
      await this.addCapability('meter_power.exported').catch((error) => {
        if (this.runtimeDebug) throw error;
        else {
          this.logMessage(
            DebugLogLevel.ERROR,
            'migrateCapabilites, addCapability error',
            error,
          ).catch(() => {});
        }
      });
    }

    for (const capability of removedCapabilitiesV1toV2) {
      if (this.getCapabilities().includes(capability)) {
        await this.logMessage(DebugLogLevel.INFO, `Removing capability ${capability}`);
      }

      try {
        await this.removeCapability(capability);
      } catch (error) {
        if (this.runtimeDebug) {
          throw error;
        } else {
          await this.logMessage(
            DebugLogLevel.ERROR,
            'migrateCapabilites, removeCapability error',
            error,
          );
        }
      }
    }

    for (const capability of addedCapabilitiesV1toV2) {
      if (!this.getCapabilities().includes(capability)) {
        await this.logMessage(DebugLogLevel.INFO, `Adding capability ${capability}`);
      }

      try {
        await this.addCapability(capability);
      } catch (error) {
        if (this.runtimeDebug) {
          throw error;
        } else {
          await this.logMessage(
            DebugLogLevel.ERROR,
            'migrateCapabilites, Production addCapability error',
            error,
          );
        }
      }
    }
  }
}

module.exports = WattsLiveDevice;
