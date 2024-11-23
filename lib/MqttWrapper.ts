'use strict';

import IMqttConnector from '../types/IMqttConnector';
import CustomMqttConnector from './CustomMqttConnector';
import HomeyMqttConnector from './HomeyMqttConnector';
import DriverSettings from '../types/DriverSettings';
import { EventEmitter } from 'events'; // Import EventEmitter
import Homey from 'homey/lib/Homey';

export default class MqttWrapper extends EventEmitter {
  private mqttConnector: IMqttConnector | null;
  homey: Homey.App['homey'];
  private subscribedTopics: string[] = [];
  private readonly debug: boolean = process.env.DEBUG !== undefined;

  
  constructor(homey: Homey.App['homey'], readonly settings: DriverSettings) {
    super();
    this.homey = homey;
    this.homey.log(this.settings.toSafeJSON());
    if (this.settings.useHomeyMqttClient==='homey') {
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
      this.emit('disconnect')
    });

    this.mqttConnector.on('error', (err) => {
      this.homey.log('MQTT error:', err.message);
    });

    process.on('unhandledRejection', (reason, p) => {
      this.homey.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    });
  }
  
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.mqttConnector?.connect().then(_ => {resolve()}).catch(err => {reject(new Error(err.message))});
    });
  }
  
  disconnect(): void {
    if (this.mqttConnector) {
      this.subscribedTopics.forEach(topic => {
        this.mqttConnector?.unsubscribe(topic);
      })
      this.mqttConnector.disconnect();
      this.mqttConnector = null;
    }
  }
  
  async subscribe(topic: string): Promise<void> {
    this.subscribedTopics.push(topic);
    await this.mqttConnector?.subscribe(topic).then(() => {
      this.mqttConnector?.on('message', (topic: string, message: any)  => {
        this.emit('message',topic, message);
      });
    });
  }
  
  async unsubscribe(topic: string): Promise<void> {
    if(this.subscribedTopics.indexOf(topic)>=0){
      this.subscribedTopics = this.subscribedTopics.splice(this.subscribedTopics.indexOf(topic),1);
      this.mqttConnector?.unsubscribe(topic);
    }
  }
  
  publish(topic: string, message: string): void {
    this.mqttConnector?.publish(topic, message);
  }
  
  async discoverDevices(topic: string, timeout:number = 10000): Promise<any[]>
  {
    return await this.mqttConnector?.discoverDevices(topic, timeout)!;
  }
}
