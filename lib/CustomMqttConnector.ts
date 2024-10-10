import { IMqttConnector } from '../types/IMqttConnector';
import { DriverSettings } from '../types/DriverSettings';
import mqtt from 'mqtt';
import Homey from 'homey/lib/Homey';

export class CustomMqttConnector implements IMqttConnector {
  private client: mqtt.MqttClient | null = null;
  private settings: DriverSettings;

  constructor(private homey: Homey.App['homey'],settings: DriverSettings) {
    this.settings = settings;
    this.homey.log("CustomMqttConnector initialized")

  }

  async connect(): Promise<void> {
    const options: mqtt.IClientOptions = {
      clientId: this.settings.clientId,
      username: this.settings.username,
      password: this.settings.password,
      host: this.settings.hostname,
      port: this.settings.port,
      protocol: this.settings.useTls ? 'mqtts' : 'mqtt',
    };

    this.client = mqtt.connect(options);

    return new Promise((resolve, reject) => {
      this.client?.on('connect', () => {
        resolve();
      });
      this.client?.on('error', (err) => {
        reject(err);
      });
    });
  }

  disconnect(): void {
    this.client?.end();
  }

  subscribe(topic: string, messageHandler: (topic: string, message: Buffer) => void): void {
    this.client?.subscribe(topic);
    this.client?.on('message', messageHandler);
  }

  unsubscribe(topic: string): void {
    this.client?.unsubscribe(topic);
  }

  publish(topic: string, message: string): void {
    this.client?.publish(topic, message);
  }
}
