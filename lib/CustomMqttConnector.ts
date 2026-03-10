'use strict';

import Homey from 'homey';
import mqtt, { IClientOptions } from 'mqtt';
import { EventEmitter } from 'events'; // Import EventEmitter
import DriverSettings from '../types/DriverSettings';
import IMqttConnector from '../types/IMqttConnector';
import delay from '../lib/delay';
import DiscoveredDevice from '../types/DiscoveredDevice';

export default class CustomMqttConnector extends EventEmitter implements IMqttConnector {

  private mqttClient: mqtt.MqttClient | null = null;
  private isConnected: boolean = false;
  private connectPromise: Promise<void> | null = null;
  private isDisconnecting: boolean = false;
  private devices: DiscoveredDevice[] = [];
  readonly homey: Homey.App['homey']; // Instance of Homey for logging
  readonly driverSettings: DriverSettings; // Connection parameters for the broker
  private readonly onClientMessage = (topic: string, message: Buffer) => {
    this.emit('message', topic, message);
  };

  constructor(homey: Homey.App['homey'], driverSettings: DriverSettings) {
    super();
    this.homey = homey;
    this.driverSettings = driverSettings;
  }

  private emitDisconnected(): void {
    if (this.isDisconnecting || (!this.mqttClient && !this.isConnected)) {
      return;
    }

    this.isConnected = false;
    this.emit('disconnect');
  }

  private getInitializedClient(): mqtt.MqttClient {
    if (!this.mqttClient) {
      throw new Error('MQTT client is not initialized');
    }
    return this.mqttClient;
  }

  private getConnectedClient(): mqtt.MqttClient {
    if (!this.mqttClient || !this.isConnected) {
      throw new Error('MQTT client is not connected');
    }
    return this.mqttClient;
  }

  private waitForClientCallback(
    register: (done: (error?: Error | null) => void) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      register((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  // Connect to the specified MQTT broker using the DriverSettings
  async connect(): Promise<void> {
    if (this.mqttClient && this.isConnected) {
      this.homey.log('Already connected to the MQTT broker');
      return;
    }

    if (this.connectPromise !== null) {
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
        reconnectPeriod: 0, // Device-level reconnect logic owns retries/backoff
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
        this.homey.log('Disconnected from MQTT broker');
        this.emitDisconnected();
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
    if (this.mqttClient === null) {
      return;
    }

    const client = this.mqttClient;
    this.isDisconnecting = true;
    await new Promise<void>((resolve) => {
      client.end(() => resolve());
    });

    client.removeListener('message', this.onClientMessage);
    this.mqttClient = null;
    this.isConnected = false;
    this.isDisconnecting = false;
    this.homey.log('MQTT client disconnected');
    this.emit('disconnect');
  }

  // Subscribe to a topic with a message handler
  async subscribe(topic: string): Promise<void> {
    const client = this.getConnectedClient();
    try {
      await this.waitForClientCallback((done) => {
        client.subscribe(topic, done);
      });
      this.homey.log(`Successfully subscribed to topic: ${topic}`);
    } catch (error) {
      this.homey.log(`Failed to subscribe to topic: ${topic}. Error: ${(error as Error).message}`);
      throw error;
    }
  }

  // Unsubscribe from a topic
  async unsubscribe(topic: string): Promise<void> {
    const client = this.getInitializedClient();
    try {
      await this.waitForClientCallback((done) => {
        client.unsubscribe(topic, done);
      });
      this.homey.log(`Successfully unsubscribed from topic: ${topic}`);
    } catch (error) {
      this.homey.log(`Failed to unsubscribe from topic: ${topic}. Error: ${(error as Error).message}`);
      throw error;
    }
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
  async discoverDevices(topic: string, timeout: number = 10000): Promise<DiscoveredDevice[]> {
    this.getConnectedClient();
    this.devices = []; // Clear any previously discovered devices
    const discoveredDeviceIds = new Set<string>();
    const onDiscoveryMessage = (receivedTopic: string) => {
      this.homey.log('Message received on topic ', receivedTopic);
      const match = receivedTopic.match(/\/?watts\/([^/]+)\/measurement/);
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
        name: `Watts Live - Device ${deviceId}`,
        data: { id: deviceId },
        settings: { deviceId },
      });
      this.homey.log(`Discovered device: ${deviceId}`);
    };

    this.on('message', onDiscoveryMessage);
    await this.subscribe(topic);

    try {
      await delay(timeout, undefined);
    } finally {
      this.off('message', onDiscoveryMessage);
      await this.unsubscribe(topic).catch((error: unknown) => {
        this.homey.log(error);
      });
    }

    this.homey.log(`Discovery complete. Devices found: ${this.devices.length}`);
    return this.devices;
  }
}
