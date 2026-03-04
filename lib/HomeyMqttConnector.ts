'use strict';

import Homey from 'homey';
import { EventEmitter } from 'events'; // Import EventEmitter
import IMqttConnector from '../types/IMqttConnector';
import delay from '../lib/delay';

export default class HomeyMqttConnector extends EventEmitter implements IMqttConnector {
  private MQTTClient: Homey.ApiApp | null = null;
  private isConnected: boolean = false;
  readonly homey: Homey.App['homey'];
  private topics: string[] = [];
  private devices: any[] = [];
  private realtimeListenerBound: boolean = false;
  private readonly onRealtimeMessage = (incomingTopic: string, message: object) => {
    this.emit('message', incomingTopic, message);
  };

  constructor(homey: Homey.App['homey']) { // Pass Homey instance to the constructor
    super();
    this.homey = homey;
    this.homey.log('HomeyMqttConnector initialized');
  }

  async connect(): Promise<void> {
    this.homey.log('connect');
    this.MQTTClient = this.homey.api.getApiApp('nl.scanno.mqtt');
    const available = await this.MQTTClient.getInstalled();
    if (available === false || this.MQTTClient === null) {
      throw new Error('nl.scanno.mqtt app not found or unavailable');
    }

    this.isConnected = true;
    this.emit('connect');
  }

  async subscribe(topic: string): Promise<void> {
    this.homey.log('subscribe');
    if (!this.MQTTClient) {
      throw new Error('MQTT client is not initialized');
    }
    const response: any = await this.MQTTClient.post('subscribe', { topic });
    if (response.result !== 0) {
      throw new Error(`Cannot subscribe to topic ${topic}: ${JSON.stringify(response)}`);
    }

    this.homey.log(`Sucessfully subscribed to topic: ${topic}`);
    if (!this.topics.includes(topic)) {
      this.topics.push(topic);
    }

    if (!this.realtimeListenerBound) {
      this.MQTTClient.on('realtime', this.onRealtimeMessage);
      this.realtimeListenerBound = true;
    }
  }

  async unsubscribe(topic: string): Promise<void> {
    if (!this.MQTTClient) {
      throw new Error('MQTT client is not initialized');
    }

    const response: any = await this.MQTTClient.post('unsubscribe', { topic });
    if (response.result !== 0) {
      throw new Error(`Cannot unsubscribe from topic ${topic}: ${JSON.stringify(response)}`);
    }

    this.homey.log(`Sucessfully unsubscribed from topic: ${topic}`);
    this.topics = this.topics.filter((subscribedTopic) => subscribedTopic !== topic);
  }

  async discoverDevices(topic: string, timeout: number = 10000): Promise<any[]> {
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
    if (this.MQTTClient && this.realtimeListenerBound) {
      this.MQTTClient.removeListener('realtime', this.onRealtimeMessage);
      this.realtimeListenerBound = false;
    }

    const topics = [...this.topics];
    for (const topic of topics) {
      await this.unsubscribe(topic).catch((error) => {
        this.homey.log(error);
      });
    }

    this.topics = [];
    this.isConnected = false;
    this.MQTTClient = null;
    this.emit('disconnect');
  }

  publish(topic: string, message: string): void {
    this.homey.log(`sendMessage: ${topic} <= ${message}`);
    this.MQTTClient?.post('send', {
      qos: 0,
      retain: false,
      mqttTopic: topic,
      mqttMessage: message,
    }).catch((error: any) => {
      if (error) {
        this.homey.error(`Error sending ${topic} <= '${message}'`);
      }
    });
  }
}
