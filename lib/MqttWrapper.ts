'use strict';

import IMqttConnector from '../types/IMqttConnector';
import CustomMqttConnector from './CustomMqttConnector';
import HomeyMqttConnector from './HomeyMqttConnector';
import DriverSettings from '../types/DriverSettings';
import Homey from 'homey/lib/Homey';

export default class MqttWrapper {
  private mqttConnector: IMqttConnector | null;
  homey: Homey.App['homey'];
  private subscribedTopics: string[] = [];
  
  constructor(homey: Homey.App['homey'], readonly settings: DriverSettings) {
    this.homey = homey;
    this.homey.log(this.settings.toSafeJSON());
    if (this.settings.useHomeyMqttClient==='homey') {
      this.mqttConnector = new HomeyMqttConnector(this.homey);
    } else {
      this.mqttConnector = new CustomMqttConnector(this.homey, this.settings);
    }
    process.on('unhandledRejection', (reason, p) => {
      this.homey.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    });
  }
  
  async connect(): Promise<void> {
    
    return this.mqttConnector?.connect();
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
  
  subscribe(topic: string, messageHandler: (topic: string, message: Buffer | string) => void): void {
    this.subscribedTopics.push(topic);
    this.mqttConnector?.subscribe(topic, messageHandler);
  }
  
  unsubscribe(topic: string): void {
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
