'use strict';

import mqtt, { IClientOptions } from 'mqtt';
import { EventEmitter } from 'events'; // Import EventEmitter
import DriverSettings from '../types/DriverSettings';
import IMqttConnector from '../types/IMqttConnector';
import delay from '../lib/delay';

export default class CustomMqttConnector extends EventEmitter implements IMqttConnector {

  private mqttClient: mqtt.MqttClient | null = null;
  private isConnected: boolean = false;
  private connectPromise: Promise<void> | null = null;
  private devices: any[] = [];
  readonly homey: any; // Instance of Homey for logging
  readonly driverSettings: DriverSettings; // Connection parameters for the broker
  private readonly onClientMessage = (topic: string, message: Buffer) => {
    this.emit('message', topic, message);
  };

  constructor(homey: any, driverSettings: DriverSettings) {
    super();
    this.homey = homey;
    this.driverSettings = driverSettings;
  }

  // Connect to the specified MQTT broker using the DriverSettings
  async connect(): Promise<void> {
    if (this.mqttClient && this.isConnected) {
      this.homey.log('Already connected to the MQTT broker');
      return;
    }

    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;

      // Configure MQTT client options using DriverSettings
      const options: IClientOptions = {
        host: this.driverSettings.hostname,
        port: this.driverSettings.port,
        clientId: this.driverSettings.clientId,
        username: this.driverSettings.username,
        password: this.driverSettings.password,
        protocol: this.driverSettings.useTls ? 'mqtts' : 'mqtt',
        reconnectPeriod: 1000, // Attempt to reconnect every 1000ms
        connectTimeout: 30 * 1000, // Timeout after 30 seconds
      };

      // If TLS is enabled and self-signed certificates are allowed
      if (this.driverSettings.useTls && this.driverSettings.acceptSelfSignedCert) {
        options.rejectUnauthorized = false; // Accept self-signed certificates
      }

      this.mqttClient = mqtt.connect(options);

      this.mqttClient.on('connect', () => {
        this.isConnected = true;
        this.homey.log(`Connected to MQTT broker at ${this.driverSettings.hostname}:${this.driverSettings.port}`);
        this.mqttClient?.removeListener('message', this.onClientMessage);
        this.mqttClient?.on('message', this.onClientMessage);
        this.emit('connect');
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      this.mqttClient.on('close', () => {
        this.isConnected = false;
        this.homey.log('Disconnected from MQTT broker');
        this.emit('disconnect');
      });

      this.mqttClient.on('error', (err) => {
        this.homey.log('MQTT error:', err.message);
        this.emit('error', err);
        if (!settled) {
          settled = true;
          if (!this.isConnected) {
            this.mqttClient?.end(true);
            this.mqttClient = null;
          }
          reject(err);
        }
      });
    });

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  // Disconnect from the MQTT broker
  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.mqttClient !== null) {
        this.mqttClient.end(() => {
          this.mqttClient?.removeListener('message', this.onClientMessage);
          this.mqttClient = null;
          this.isConnected = false;
          this.homey.log('MQTT client disconnected');
          this.emit('disconnect');
          return resolve();
        });
      } else {
        return resolve();
      }
    });
  }

  // Subscribe to a topic with a message handler
  async subscribe(topic: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.mqttClient) {
        this.homey.log('MQTT client is not connected');
        reject(new Error('MQTT client is not connected'));
        return;
      }

      this.mqttClient.subscribe(topic, (err) => {
        if (err) {
          this.homey.log(`Failed to subscribe to topic: ${topic}. Error: ${err.message}`);
          reject(err);
        } else {
          this.homey.log(`Successfully subscribed to topic: ${topic}`);
          resolve();
        }
      });
    });
  }

  // Unsubscribe from a topic
  async unsubscribe(topic: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.mqttClient) {
        return reject(new Error('MQTT Client not initialized'));
      }

      this.mqttClient.unsubscribe(topic, (err) => {
        if (err) {
          this.homey.log(`Failed to unsubscribe from topic: ${topic}. Error: ${err.message}`);
          reject(err);
        } else {
          this.homey.log(`Successfully unsubscribed from topic: ${topic}`);
          resolve();
        }
      });
    });
  }

  // Publish a message to a specific topic
  publish(topic: string, message: string): void {
    if (!this.mqttClient || !this.isConnected) {
      this.homey.log('MQTT client is not connected');
      return;
    }

    this.mqttClient.publish(topic, message, (err) => {
      if (err) {
        this.homey.log(`Failed to publish message to topic: ${topic}. Error: ${err.message}`);
      } else {
        this.homey.log(`Successfully published message to topic: ${topic}`);
      }
    });
  }

  // Discover devices by subscribing to a discovery topic and listening for messages
  async discoverDevices(topic: string, timeout: number = 10000): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.mqttClient || !this.isConnected) {
        return reject(new Error('MQTT client not connected'));
      }

      this.devices = []; // Clear any previously discovered devices

      this.mqttClient.subscribe(topic, (err) => {
        if (err) {
          return reject(new Error(`Failed to subscribe to topic: ${topic}`));
        }
        this.homey.log(`Successfully subscribed to topic: ${topic}`);
      });

      const onDiscoveryMessage = (receivedTopic: string) => {
        this.homey.log('Message received on topic ', receivedTopic);
        const match = RegExp(/\/?watts\/([^/]+)\/measurement/).exec(receivedTopic);
        if (!match) {
          return;
        }

        const deviceId = match[1];
        if (!this.devices.find((device) => device.id === deviceId)) {
          this.devices.push({
            id: deviceId,
            name: `Watts Live - Device ${deviceId}`,
            data: { id: deviceId },
            settings: { deviceId },
          });
          this.homey.log(`Discovered device: ${deviceId}`);
        }
      };

      this.on('message', onDiscoveryMessage);

      delay(timeout, undefined).then(() => {
        this.off('message', onDiscoveryMessage);
        this.mqttClient?.unsubscribe(topic);
        this.homey.log(`Discovery complete. Devices found: ${this.devices.length}`);
        return resolve(this.devices);
      }).catch((error) => {
        this.off('message', onDiscoveryMessage);
        this.homey.log(JSON.stringify(error));
        return reject(JSON.stringify(error));
      });
    });
  }
}
