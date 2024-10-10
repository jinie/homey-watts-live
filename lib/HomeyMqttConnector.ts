import Homey from 'homey';
import { IMqttConnector } from '../types/IMqttConnector';
import { DriverSettings } from '../types/DriverSettings';

export class HomeyMqttConnector implements IMqttConnector {
    private MQTTClient: Homey.ApiApp | null = null;
    private isConnected: boolean;
    private homey: Homey.App['homey'];

    constructor(homey: Homey.App['homey']) {  // Pass Homey instance to the constructor
        this.isConnected = false;
        this.homey = homey;
        this.homey.log("HomeyMqttConnector initialized")
    }

    configure(settings: DriverSettings): void {}

    async connect(): Promise<void> {
        try {
            // Get access to the nl.scanno.mqtt API app
            this.MQTTClient = await this.homey.api.getApiApp('nl.scanno.mqtt');
            if (!this.MQTTClient) {
                throw new Error('nl.scanno.mqtt app not found or unavailable');
            }

            // Connect to the MQTT client via its API
            this.isConnected = true;
        } catch (error) {
            console.error('Error connecting to MQTT client:', error);
            throw error;
        }
    }

    subscribe(topic: string, messageHandler: (topic: string, message: string) => void): void {
        this.MQTTClient?.post('subscribe', { topic: topic }).then((error: any) => {
            if (error.result != 0) {
              this.homey.log(`Can not subscrive to topic ${topic}, error: ${JSON.stringify(error)}`)
            } else {
              this.homey.log(`Sucessfully subscribed to topic: ${topic}`);
            }
          });
          this.MQTTClient?.on('realtime', (topic: string, message: string) => {
            messageHandler(topic, message);
          });
    }

    async unsubscribe(topic: string): Promise<void> {

    }

    listenForDevices(topic: string, onDeviceDiscovered: (device: any) => void): void {
        if (!this.isConnected) {
            throw new Error('MQTT client is not connected');
        }

        this.subscribe(topic, (topic: string, message: Buffer | string) => {
            const match = topic.match(/\/watts\/(.+)\/measurement/);
            if (match) {
                const deviceId = match[1];
                const deviceName = `Device ${deviceId}`;
                onDeviceDiscovered({ id: deviceId, name: deviceName });
            }
        });

        this.unsubscribe(topic);
    }

    disconnect(): void {

    }


  publish(topic: string, message: string): void {
    this.homey.log(`sendMessage: ${topic} <= ${message}`);
    this.MQTTClient?.post('send', {
      qos: 0,
      retain: false,
      mqttTopic: topic,
      mqttMessage: message
    }).catch((error: any) => {
      if (error)
        this.homey.log(`Error sending ${topic} <= "${message}"`);
    });
  }
}

export default HomeyMqttConnector;
