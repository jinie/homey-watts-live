'use strict';

import Homey from 'homey';
import { EventEmitter } from 'events'; // Import EventEmitter
import IMqttConnector from '../types/IMqttConnector';
import delay from './delay';

export default class HomeyMqttConnector extends EventEmitter implements IMqttConnector {

  private MQTTClient: Homey.ApiApp | null = null;
  private isConnected: boolean;
  readonly homey: Homey.App['homey'];
  readonly topics: string[] = [];
  readonly devices: any[] = [];
  private readonly debug: boolean = process.env.DEBUG !== undefined;


  constructor(homey: Homey.App['homey']) { // Pass Homey instance to the constructor
    super();
    this.isConnected = false;
    this.homey = homey;
    this.homey.log('HomeyMqttConnector initialized');
    process.on('unhandledRejection', (reason, p) => {
      this.homey.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    });
  }

  async connect(): Promise<void> {
    this.homey.log('connect');
    this.MQTTClient = this.homey.api.getApiApp('nl.scanno.mqtt');
    const available = await this.MQTTClient.getInstalled();
    return new Promise((resolve, reject) => {
      try {
        // Get access to the nl.scanno.mqtt API app

        if (available === false || !this.MQTTClient === null) {
          reject(new Error('nl.scanno.mqtt app not found or unavailable'));
        }

        // Connect to the MQTT client via its API
        this.isConnected = true;
        resolve();
      } catch (error: any) {
        this.homey.error('Error connecting to MQTT client:', error);
        reject(new Error(error.message));
      }
    });
  }

  async subscribe(topic: string): Promise<void> {
    this.homey.log('subscribe');
    return new Promise((resolve, reject) => {
      this.MQTTClient?.post('subscribe', { topic }).then((error: any) => {
        if (error.result !== 0) {
          this.homey.error(`Cannot subscribe to topic ${topic}, error: ${JSON.stringify(error)}`)
          reject(JSON.stringify(error));
        } else {
          this.homey.log(`Sucessfully subscribed to topic: ${topic}`);
          this.topics.push(topic);
          resolve();
        }
      }).catch((error) => { reject(JSON.stringify(error)); });
      this.MQTTClient?.on('realtime', (topic: string, message: object) => {
        // messageHandler(topic, message);
        this.emit('message', topic, message);
      });
      resolve();
    });
  }

  async unsubscribe(topic: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.MQTTClient?.post('unsubscribe', { topic }).then((error: any) => {
        if (error.result !== 0) {
          this.homey.error(`Cannot unsubscribe from topic ${topic}, error: ${JSON.stringify(error)}`)
          reject(Error(JSON.stringify(error)));
        } else {
          this.homey.log(`Sucessfully unsubscribed from topic: ${topic}`);
          resolve();
        }
      }).catch((error) => { reject(JSON.stringify(error)); });
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
      this.subscribe(topic).then(() => {
        this.homey.log(`Message received on topic ${topic}`);
        this.on('message', (topic: string, _) => {
          // Extract device ID from the topic
          const match = topic.match(/\/?watts\/(.+)\/measurement/);
          if (match) {
            const deviceId = match[1];
            // Add the discovered device to the list
            this.devices.push({
              id: deviceId,
              name: `Watts Live - ${deviceId}`,
              data: { id: deviceId },
              settings: { deviceId },
            });
          }
        });
      }).catch((error) => {
        this.homey.log(JSON.stringify(error));
        return reject(error);
      });

      delay(timeout, this.devices).then(() => {
        this.homey.log(`timeout expired : ${timeout}`);
        this.unsubscribe(topic).catch((error) => {
          this.homey.log(error);
        });
        this.disconnect().catch((error) => {
          this.homey.log(error);
        });

        if (this.devices.length === 0) {
          // Log a message if no devices were discovered
          this.homey.log('No devices discovered within the timeout.');
        } else {
          // Log the discovered devices
          this.homey.log(`Discovered devices: ${JSON.stringify(this.devices)}`);
        }

        // Resolve the promise with the list of devices
        return resolve(this.devices);
      }).catch((error) => {
        this.homey.log(JSON.stringify(error));
        return reject(error);
      });
    });
  }


  async disconnect(): Promise<void> {
    for (const topic of this.topics) {
      await this.unsubscribe(topic);
    }
  }


  publish(topic: string, message: string): void {
    this.homey.log(`sendMessage: ${topic} <= ${message}`);
    this.MQTTClient?.post('send', {
      qos: 0,
      retain: false,
      mqttTopic: topic,
      mqttMessage: message
    }).catch((error: any) => {
      if (error) {
        this.homey.error(`Error sending ${topic} <= '${message}'`);
      }
    });
  }
}
