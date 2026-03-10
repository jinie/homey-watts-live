'use strict';

import Homey from 'homey';
import { EventEmitter } from 'events'; // Import EventEmitter
import IMqttConnector from '../types/IMqttConnector';
import DriverSettings from '../types/DriverSettings';
import DiscoveredDevice from '../types/DiscoveredDevice';

export default class MqttWrapper extends EventEmitter {

  private mqttConnector: IMqttConnector | null;
  homey: Homey.App['homey'];
  private subscribedTopics: string[] = [];

  constructor(homey: Homey.App['homey'], readonly settings: DriverSettings) {
    super();
    this.homey = homey;
    this.mqttConnector = null;
    this.homey.log(this.settings.toSafeJSON());
  }

  private bindConnectorEvents(connector: IMqttConnector): void {
    // Listen for events
    connector.on('connect', () => {
      this.homey.log('MQTT broker connected');
      this.emit('connect');
    });

    connector.on('disconnect', () => {
      this.homey.log('MQTT broker disconnected');
      this.emit('disconnect');
    });

    connector.on('error', (err) => {
      this.homey.log('MQTT error:', err.message);
      this.emit('error', err);
    });

    connector.on('message', (topic: string, message: unknown) => {
      this.emit('message', topic, message);
    });
  }

  private resolveConnectorConstructor(
    moduleNamespace: unknown,
    moduleLabel: string,
  ): new (...args: never[]) => IMqttConnector {
    const namespaceRecord = (moduleNamespace && typeof moduleNamespace === 'object')
      ? moduleNamespace as Record<string, unknown>
      : {};
    const first = namespaceRecord.default ?? moduleNamespace;
    const firstRecord = (first && typeof first === 'object')
      ? first as Record<string, unknown>
      : {};
    const resolved = firstRecord.default ?? first;

    if (typeof resolved !== 'function') {
      throw new Error(`${moduleLabel} does not export a connector constructor`);
    }

    return resolved as new (...args: never[]) => IMqttConnector;
  }

  private async ensureConnector(): Promise<IMqttConnector> {
    if (this.mqttConnector) {
      return this.mqttConnector;
    }

    let connector: IMqttConnector;
    if (this.settings.useHomeyMqttClient === 'homey') {
      // eslint-disable-next-line node/no-missing-import
      const homeyModule = await import('./HomeyMqttConnector.js');
      const HomeyMqttConnector = this.resolveConnectorConstructor(
        homeyModule,
        'HomeyMqttConnector',
      ) as new (homey: Homey.App['homey']) => IMqttConnector;
      connector = new HomeyMqttConnector(this.homey);
    } else {
      // Load custom MQTT connector only when needed.
      // eslint-disable-next-line node/no-missing-import
      const customModule = await import('./CustomMqttConnector.js');
      const CustomMqttConnector = this.resolveConnectorConstructor(
        customModule,
        'CustomMqttConnector',
      ) as new (
        homey: Homey.App['homey'],
        settings: DriverSettings
      ) => IMqttConnector;
      connector = new CustomMqttConnector(this.homey, this.settings);
    }

    this.mqttConnector = connector;
    this.bindConnectorEvents(connector);
    return connector;
  }

  async connect(): Promise<void> {
    const connector = await this.ensureConnector();
    await connector.connect();
  }

  async disconnect(): Promise<void> {
    if (!this.mqttConnector) {
      return;
    }

    const topicsToUnsubscribe = [...this.subscribedTopics];
    for (const topic of topicsToUnsubscribe) {
      try {
        await this.mqttConnector.unsubscribe(topic);
      } catch (error) {
        this.homey.log(`Error unsubscribing from topic ${topic}`, error);
      }
    }

    await this.mqttConnector.disconnect();
    this.subscribedTopics = [];
    this.mqttConnector = null;
  }

  async subscribe(topic: string): Promise<void> {
    const connector = await this.ensureConnector();
    if (this.subscribedTopics.includes(topic)) {
      return;
    }
    await connector.subscribe(topic);
    this.subscribedTopics.push(topic);
  }

  async unsubscribe(topic: string): Promise<void> {
    if (!this.mqttConnector) {
      return;
    }
    if (!this.subscribedTopics.includes(topic)) {
      return;
    }

    await this.mqttConnector.unsubscribe(topic);
    this.subscribedTopics = this.subscribedTopics.filter((t) => t !== topic);
  }

  publish(topic: string, message: string): void {
    this.mqttConnector?.publish(topic, message);
  }

  async discoverDevices(topic: string, timeout: number = 10000): Promise<DiscoveredDevice[]> {
    const connector = await this.ensureConnector();
    return connector.discoverDevices(topic, timeout);
  }

}
