'use strict';

import Homey from 'homey';
import { EventEmitter } from 'events'; // Import EventEmitter
import IMqttConnector from '../types/IMqttConnector';
import CustomMqttConnector from '../lib/CustomMqttConnector';
import HomeyMqttConnector from '../lib/HomeyMqttConnector';
import DriverSettings from '../types/DriverSettings';

export default class MqttWrapper extends EventEmitter {

  private mqttConnector: IMqttConnector | null;
  homey: Homey.App['homey'];
  private subscribedTopics: string[] = [];

  constructor(homey: Homey.App['homey'], readonly settings: DriverSettings) {
    super();
    this.homey = homey;
    this.homey.log(this.settings.toSafeJSON());
    if (this.settings.useHomeyMqttClient === 'homey') {
      this.mqttConnector = new HomeyMqttConnector(this.homey);
    } else {
      this.mqttConnector = new CustomMqttConnector(this.homey, this.settings);
    }
    // Listen for events
    this.mqttConnector.on('connect', () => {
      this.homey.log('MQTT broker connected');
      this.emit('connect');
    });

    this.mqttConnector.on('disconnect', () => {
      this.homey.log('MQTT broker disconnected');
      this.emit('disconnect');
    });

    this.mqttConnector.on('error', (err) => {
      this.homey.log('MQTT error:', err.message);
    });

    this.mqttConnector.on('message', (topic: string, message: any) => {
      this.emit('message', topic, message);
    });
  }

  async connect(): Promise<void> {
    if (!this.mqttConnector) {
      throw new Error('MQTT connector is not initialized');
    }
    await this.mqttConnector.connect();
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
    if (!this.mqttConnector) {
      throw new Error('MQTT connector is not initialized');
    }
    if (this.subscribedTopics.includes(topic)) {
      return;
    }
    await this.mqttConnector.subscribe(topic);
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

  async discoverDevices(topic: string, timeout: number = 10000): Promise<any[]> {
    if (this.mqttConnector !== null) {
      return this.mqttConnector.discoverDevices(topic, timeout);
    }
    return [];
  }

}
