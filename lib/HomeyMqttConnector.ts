'use strict';

import Homey from 'homey';
import { EventEmitter } from 'events'; // Import EventEmitter
import IMqttConnector from '../types/IMqttConnector';
import delay from '../lib/delay';
import DiscoveredDevice from '../types/DiscoveredDevice';

interface HomeyMqttApiResponse {
  result: number;
  [key: string]: unknown;
}

export default class HomeyMqttConnector extends EventEmitter implements IMqttConnector {
  private MQTTClient: Homey.ApiApp | null = null;
  private isConnected: boolean = false;
  readonly homey: Homey.App['homey'];
  private topics: string[] = [];
  private devices: DiscoveredDevice[] = [];
  private realtimeListenerBound: boolean = false;
  private isDisconnecting: boolean = false;
  private apiLifecycleListenersBound: boolean = false;
  private readonly onRealtimeMessage = (incomingTopic: string, message: object) => {
    this.emit('message', incomingTopic, message);
  };

  private readonly onApiAppInstall = () => {
    this.handleApiAppInstall().catch((error) => {
      this.homey.error('Homey MQTT install handler failed', error);
    });
  };

  private readonly onApiAppUninstall = () => {
    this.transitionToDisconnected().catch((error) => {
      this.homey.error('Homey MQTT uninstall handler failed', error);
    });
  };

  constructor(homey: Homey.App['homey']) { // Pass Homey instance to the constructor
    super();
    this.homey = homey;
    this.homey.log('HomeyMqttConnector initialized');
  }

  private getApiApp(): Homey.ApiApp {
    return this.homey.api.getApiApp('nl.scanno.mqtt');
  }

  private async ensureApiAppAvailable(): Promise<Homey.ApiApp> {
    const mqttClient = this.getApiApp();
    const available = await mqttClient.getInstalled();
    if (available === false) {
      throw new Error('nl.scanno.mqtt app not found or unavailable');
    }

    this.MQTTClient = mqttClient;
    return mqttClient;
  }

  private bindApiAppListeners(): void {
    if (!this.MQTTClient) {
      return;
    }

    if (!this.realtimeListenerBound) {
      this.MQTTClient.on('realtime', this.onRealtimeMessage);
      this.realtimeListenerBound = true;
    }

    if (!this.apiLifecycleListenersBound) {
      this.MQTTClient.on('install', this.onApiAppInstall);
      this.MQTTClient.on('uninstall', this.onApiAppUninstall);
      this.apiLifecycleListenersBound = true;
    }
  }

  private removeApiAppListeners(): void {
    if (!this.MQTTClient) {
      return;
    }

    if (this.realtimeListenerBound) {
      this.MQTTClient.removeListener('realtime', this.onRealtimeMessage);
      this.realtimeListenerBound = false;
    }

    if (this.apiLifecycleListenersBound) {
      this.MQTTClient.removeListener('install', this.onApiAppInstall);
      this.MQTTClient.removeListener('uninstall', this.onApiAppUninstall);
      this.apiLifecycleListenersBound = false;
    }
  }

  private async registerApiApp(): Promise<void> {
    const mqttClient = this.MQTTClient ?? await this.ensureApiAppAvailable();
    const registerFn = (mqttClient as Homey.ApiApp & {
      register?: () => Promise<unknown> | unknown;
    }).register;

    if (typeof registerFn === 'function') {
      await registerFn.call(mqttClient);
    }
  }

  private async handleApiAppInstall(): Promise<void> {
    if (this.isDisconnecting) {
      return;
    }

    await this.ensureApiAppAvailable();
    await this.registerApiApp();
    this.bindApiAppListeners();
    this.isConnected = true;
    this.emit('connect');

    for (const topic of [...this.topics]) {
      await this.subscribeTopic(topic, {
        trackTopic: false,
      });
    }
  }

  private async subscribeTopic(
    topic: string,
    options?: {
      trackTopic?: boolean;
      logSuccess?: boolean;
    },
  ): Promise<void> {
    const mqttClient = this.MQTTClient ?? await this.ensureApiAppAvailable();
    await this.registerApiApp();
    this.bindApiAppListeners();
    const response = await mqttClient.post('subscribe', { topic }) as HomeyMqttApiResponse;
    if (response.result !== 0) {
      throw new Error(`Cannot subscribe to topic ${topic}: ${JSON.stringify(response)}`);
    }

    if (options?.trackTopic !== false && !this.topics.includes(topic)) {
      this.topics.push(topic);
    }

    if (options?.logSuccess !== false) {
      this.homey.log(`Sucessfully subscribed to topic: ${topic}`);
    }
  }

  private async transitionToDisconnected(): Promise<void> {
    if (!this.isConnected && !this.MQTTClient && !this.realtimeListenerBound) {
      return;
    }

    if (this.isDisconnecting) {
      return;
    }

    this.isDisconnecting = true;
    try {
      this.removeApiAppListeners();
      this.isConnected = false;
      this.MQTTClient = null;
      this.emit('disconnect');
    } finally {
      this.isDisconnecting = false;
    }
  }

  private async handleOperationalFailure(context: string, error: unknown): Promise<never> {
    const err = error instanceof Error ? error : new Error(String(error));
    this.emit('error', err);
    this.homey.log(`${context}: ${err.message}`);
    await this.transitionToDisconnected();
    throw err;
  }

  async connect(): Promise<void> {
    this.homey.log('connect');
    if (this.isConnected) {
      return;
    }

    await this.ensureApiAppAvailable();
    await this.registerApiApp();
    this.bindApiAppListeners();
    this.isConnected = true;
    this.emit('connect');
  }

  async subscribe(topic: string): Promise<void> {
    this.homey.log('subscribe');
    try {
      await this.subscribeTopic(topic);
    } catch (error) {
      await this.handleOperationalFailure(`Failed to subscribe to topic ${topic}`, error);
    }
  }

  async unsubscribe(topic: string): Promise<void> {
    if (!this.MQTTClient) {
      throw new Error('MQTT client is not initialized');
    }

    const response = await this.MQTTClient.post('unsubscribe', { topic }) as HomeyMqttApiResponse;
    if (response.result !== 0) {
      throw new Error(`Cannot unsubscribe from topic ${topic}: ${JSON.stringify(response)}`);
    }

    this.homey.log(`Sucessfully unsubscribed from topic: ${topic}`);
    this.topics = this.topics.filter((subscribedTopic) => subscribedTopic !== topic);
  }

  async discoverDevices(topic: string, timeout: number = 10000): Promise<DiscoveredDevice[]> {
    this.homey.log('Discovering devices');
    if (!this.isConnected) {
      throw new Error('MQTT client is not connected');
    }

    this.devices = [];
    const discoveredDeviceIds = new Set<string>();
    const onMessage = (incomingTopic: string) => {
      const match = incomingTopic.match(/\/?watts\/([^/]+)\/measurement/);
      if (!match) {
        return;
      }

      const deviceId = match[1];
      if (discoveredDeviceIds.has(deviceId)) {
        return;
      }

      discoveredDeviceIds.add(deviceId);
      this.devices.push({
        id: deviceId,
        name: `Watts Live - ${deviceId}`,
        data: { id: deviceId },
        settings: { deviceId },
      });
    };

    await this.subscribe(topic);
    this.on('message', onMessage);

    try {
      await delay(timeout, undefined);
    } finally {
      this.off('message', onMessage);
      await this.unsubscribe(topic).catch((error) => {
        this.homey.log(error);
      });
    }

    if (this.devices.length === 0) {
      this.homey.log('No devices discovered within the timeout.');
    } else {
      this.homey.log(`Discovered devices: ${JSON.stringify(this.devices)}`);
    }

    return this.devices;
  }

  async disconnect(): Promise<void> {
    if (!this.MQTTClient && !this.isConnected) {
      return;
    }

    const topics = [...this.topics];
    for (const topic of topics) {
      await this.unsubscribe(topic).catch((error) => {
        this.homey.log(error);
      });
    }

    this.topics = [];
    await this.transitionToDisconnected();
  }

  publish(topic: string, message: string): void {
    this.homey.log(`sendMessage: ${topic} <= ${message}`);
    this.MQTTClient?.post('send', {
      qos: 0,
      retain: false,
      mqttTopic: topic,
      mqttMessage: message,
    }).catch((error: unknown) => {
      if (error instanceof Error) {
        this.homey.error(`Error sending ${topic} <= '${message}': ${error.message}`);
      } else if (error) {
        this.homey.error(`Error sending ${topic} <= '${message}'`);
      }
      this.handleOperationalFailure(`Failed to publish to topic ${topic}`, error).catch(() => {});
    });
  }
}
