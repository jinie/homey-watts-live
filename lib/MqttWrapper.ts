
import { IMqttConnector } from '../types/IMqttConnector';
import { CustomMqttConnector } from './CustomMqttConnector';
import { HomeyMqttConnector } from './HomeyMqttConnector';
import { DriverSettings } from '../types/DriverSettings';
import Homey from 'homey/lib/Homey';

export class MqttWrapper {
  private mqttConnector: IMqttConnector;
  homey: Homey.App['homey'];

  constructor(homey: Homey.App['homey'], private settings: DriverSettings) {
    this.homey = homey;
    if (this.settings.useHomeyMqttClient==="homey") {
      this.mqttConnector = new HomeyMqttConnector(this.homey);
    } else {
      this.mqttConnector = new CustomMqttConnector(this.homey, this.settings);
    }
  }

  async connect(): Promise<void> {

    return this.mqttConnector.connect();
  }

  disconnect(): void {
    if (this.mqttConnector) {
      this.mqttConnector.disconnect();
    }
  }

  subscribe(topic: string, messageHandler: (topic: string, message: Buffer | string) => void): void {
    this.mqttConnector?.subscribe(topic, messageHandler);
  }

  unsubscribe(topic: string): void {
    this.mqttConnector?.unsubscribe(topic);
  }

  publish(topic: string, message: string): void {
    this.mqttConnector?.publish(topic, message);
  }
}
