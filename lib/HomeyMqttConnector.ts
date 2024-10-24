'use strict';

import Homey from 'homey';
import IMqttConnector from '../types/IMqttConnector';

export default class HomeyMqttConnector implements IMqttConnector {
  private MQTTClient: Homey.ApiApp | null = null;
  private isConnected: boolean;
  readonly homey: Homey.App['homey'];
  readonly topics: string[] = [];
  readonly devices: any[] = [];

  constructor(homey: Homey.App['homey']) {  // Pass Homey instance to the constructor
    this.isConnected = false;
    this.homey = homey;
    this.homey.log('HomeyMqttConnector initialized');
    process.on('unhandledRejection', (reason, p) => {
      this.homey.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    });
  }
  
  async connect(): Promise<void> {
    try {
      // Get access to the nl.scanno.mqtt API app
      this.MQTTClient = this.homey.api.getApiApp('nl.scanno.mqtt');
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
        this.homey.log(`Cannot subscribe to topic ${topic}, error: ${JSON.stringify(error)}`)
      } else {
        this.homey.log(`Sucessfully subscribed to topic: ${topic}`);
        this.topics.push(topic);
      }
    });
    this.MQTTClient?.on('realtime', (topic: string, message: string) => {
      messageHandler(topic, message);
    });
  }

  async unsubscribe(topic: string): Promise<void> {
    this.MQTTClient?.post('unsubscribe', { topic: topic }).then((error: any) => {
      if (error.result != 0) {
        this.homey.log(`Cannot unsubscribe from topic ${topic}, error: ${JSON.stringify(error)}`)
      } else {
        this.homey.log(`Sucessfully unsubscribed from topic: ${topic}`);
      }
    });
  }

  async discoverDevices(topic: string, timeout: number = 10000): Promise<any[]> {
    this.homey.log('Discovering devices');

    return new Promise((resolve, reject) => {

      // Check if the client is connected
      if (!this.isConnected) {
        return reject(new Error('MQTT client is not connected'));
      }

      // Subscribe to the topic
      this.subscribe(topic, (topic: string, message: string) => {
        this.homey.log(`Message received on topic ${topic}`);

        // Extract device ID from the topic
        const match = topic.match(/\/?watts\/(.+)\/measurement/);
        if (match) {
          const deviceId = match[1];
          // Add the discovered device to the list
          this.devices.push({
            id: deviceId,
            name: `Watts Live - ${deviceId}`,
            data: { id: deviceId },
            settings: { deviceId: deviceId }
          });
          //this.homey.log(`Discovered device ${deviceId}`);
        }
      });

      // Set a timeout to stop discovery after the specified time
      setTimeout(() => {
        // Unsubscribe from the topic and disconnect the MQTT client
        this.unsubscribe(topic);
        this.disconnect();

        if (this.devices.length === 0) {
          // Log a message if no devices were discovered
          this.homey.log('No devices discovered within the timeout.');
        } else {
          // Log the discovered devices
          this.homey.log(`Discovered devices: ${JSON.stringify(this.devices)}`);
        }

        // Resolve the promise with the list of devices
        resolve(this.devices);
      }, timeout);

    });
  }


  disconnect(): void {
    this.topics.forEach(topic => {
      this.unsubscribe(topic);
    })
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
        this.homey.log(`Error sending ${topic} <= '${message}'`);
    });
  }
};