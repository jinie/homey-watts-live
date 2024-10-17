import mqtt from 'mqtt';
import { IClientOptions } from 'mqtt';
import { DriverSettings } from '../types/DriverSettings';
import { IMqttConnector } from '../types/IMqttConnector';

export class CustomMqttConnector implements IMqttConnector {
  private mqttClient: mqtt.MqttClient | null = null;
  private isConnected: boolean = false;
  private devices: any[] = [];
  private homey: any;  // Instance of Homey for logging
  private driverSettings: DriverSettings;  // Connection parameters for the broker
  
  constructor(homey: any, driverSettings: DriverSettings) {
    this.homey = homey;
    this.driverSettings = driverSettings;
  }
  
  // Connect to the specified MQTT broker using the DriverSettings
  public async connect(): Promise<void> {
    if (this.mqttClient && this.isConnected) {
      this.homey.log('Already connected to the MQTT broker');
      return;
    }
    
    return new Promise((resolve, reject) => {
      // Configure MQTT client options using DriverSettings
      const options: IClientOptions = {
        host: this.driverSettings.hostname,
        port: this.driverSettings.port,
        clientId: this.driverSettings.clientId,
        username: this.driverSettings.username,
        password: this.driverSettings.password,
        protocol: this.driverSettings.useTls ? 'mqtts' : 'mqtt',
      };
      
      // If TLS is enabled and self-signed certificates are allowed
      if (this.driverSettings.useTls && this.driverSettings.acceptSelfSignedCert) {
        options.rejectUnauthorized = false;  // Accept self-signed certificates
      }
      
      this.mqttClient = mqtt.connect(options);
      
      this.mqttClient.on('connect', () => {
        this.isConnected = true;
        this.homey.log(`Connected to MQTT broker at ${this.driverSettings.hostname}:${this.driverSettings.port}`);
        resolve();
      });
      
      this.mqttClient.on('error', (err) => {
        this.homey.log('MQTT error:', err.message);
        reject(err);
      });
      
      /*this.mqttClient.on('message', (topic, message) => {
      this.onMessageReceived(topic, message.toString());
      });*/
    });
  }
  
  // Disconnect from the MQTT broker
  public async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.mqttClient) {
        this.mqttClient.end(() => {
          this.mqttClient = null;
          this.isConnected = false;
          this.homey.log('MQTT client disconnected');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
  
  // Subscribe to a topic with a message handler
  public subscribe(topic: string, messageHandler: (topic: string, message: Buffer | string) => void): void {
    if (!this.isConnected || !this.mqttClient) {
      this.homey.log('MQTT client is not connected');
      return;
    }
    
    this.mqttClient.subscribe(topic, (err) => {
      if (err) {
        this.homey.log(`Failed to subscribe to topic: ${topic}. Error: ${err.message}`);
      } else {
        this.homey.log(`Successfully subscribed to topic: ${topic}`);
      }
    });
    
    this.mqttClient.on('message', (receivedTopic, message) => {
      if (receivedTopic === topic) {
        messageHandler(receivedTopic, message.toString());
      }
    });
  }
  
  // Unsubscribe from a topic
  public unsubscribe(topic: string): void {
    if (!this.mqttClient) {
      this.homey.log('MQTT client not initialized');
      return;
    }
    
    this.mqttClient.unsubscribe(topic, (err) => {
      if (err) {
        this.homey.log(`Failed to unsubscribe from topic: ${topic}. Error: ${err.message}`);
      } else {
        this.homey.log(`Successfully unsubscribed from topic: ${topic}`);
      }
    });
  }
  
  // Publish a message to a specific topic
  public publish(topic: string, message: string): void {
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
  public async discoverDevices(topic: string, timeout: number = 10000): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.mqttClient || !this.isConnected) {
        return reject(new Error('MQTT client not connected'));
      }
      
      this.devices = [];  // Clear any previously discovered devices
      
      this.mqttClient.subscribe(topic, (err) => {
        if (err) {
          return reject(new Error(`Failed to subscribe to topic: ${topic}`));
        }
        this.homey.log(`Successfully subscribed to topic: ${topic}`);
        
        // Listen for messages on the topic
        this.mqttClient?.on('message', (receivedTopic, message) => {
          this.homey.log("Message received on topic ",receivedTopic)
          const match = receivedTopic.match(/\/?watts\/([^\/]+)\/measurement/);
          if (match) {
            const deviceId = match[1];
            if (!this.devices.find(device => device.id === deviceId)) {
              this.devices.push({
                id: deviceId,
                name: `Watts Live - Device ${deviceId}`,
                data: {id: deviceId},
                settings: {deviceId: deviceId}
              });
              this.homey.log(`Discovered device: ${deviceId}`);
            }
          }
        });
        
        // Timeout to stop the discovery process
        setTimeout(() => {
          this.mqttClient?.unsubscribe(topic);
          this.homey.log(`Discovery complete. Devices found: ${this.devices.length}`);
          resolve(this.devices);
        }, timeout);
      });
    });
  }
  
  // Default message handler for logging purposes
  private onMessageReceived(topic: string, message: string): void {
    this.homey.log(`Message received on topic ${topic}: ${message}`);
  }
}
