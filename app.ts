'use strict';

import Homey, { ApiApp } from 'homey';

export class WattsLiveApp extends Homey.App {
  private MQTTClient: Homey.ApiApp = this.homey.api.getApiApp('nl.scanno.mqtt') as ApiApp;
  private clientAvailable: boolean = false;
  private lastMqttMessage: number | undefined = undefined;
  private topics: string[] = [];
  private drivers: any = {};
  private applicationVersion: any;
  private debug: boolean = false;
  private applicationName: string = this.homey.manifest.name.en;
  private mqttClientInitialized: boolean = false;

  subscribeTopic(topicName: string) {
    this.log("Subscribing to topic: " + topicName);
    if (!this.clientAvailable){
      this.log(`MQTT client not available, can not subscribe to topic: ${topicName}`);
      return;
    }
    return this.MQTTClient.post('subscribe', { topic: topicName }).then((error: any) => {
      if (error.result != 0) {
        this.log(`Can not subscrive to topic ${topicName}, error: ${JSON.stringify(error)}`)
      } else {
        this.log(`Sucessfully subscribed to topic: ${topicName}`);
      }
    });
  }

  sendMessage(topic: string, payload: string) {
    this.log(`sendMessage: ${topic} <= ${payload}`);
    if (!this.clientAvailable)
      return;
    this.MQTTClient.post('send', {
      qos: 0,
      retain: false,
      mqttTopic: topic,
      mqttMessage: payload
    }).catch((error: any) => {
      if (error)
        this.log(`Error sending ${topic} <= "${payload}"`);
    });
  }

  onMessage(topic: string, message: string) {
    let topicParts = topic.split('/');
    if (topicParts.length > 1) {
      this.lastMqttMessage = Date.now();
      let prefixFirst = this.topics.includes(topicParts[0]);
      if (prefixFirst || this.topics.includes(topicParts[1]))
        Object.keys(this.drivers).forEach((driverId) => {
          this.drivers[driverId].onMessage(topic, message, prefixFirst);
        });
    }
  }

  setupMqttClient() {
    if(this.mqttClientInitialized)
      return;
    this.MQTTClient
    .on('install', () => this.register())
    .on('uninstall', () => this.unregister())
    .on('realtime', (topic: string, message: string) => {
      this.onMessage(topic, message);
    });
    this.mqttClientInitialized = true;
  }
  connectMqttClient() {

    this.setupMqttClient();
    this.MQTTClient.getInstalled()
      .then((installed: boolean) => {
        this.clientAvailable = installed;
        this.log(`MQTT client status: ${this.clientAvailable}`);
        if (installed) {
          this.register();
          this.homey.apps.getVersion(this.MQTTClient).then((version) => {
            this.log(`MQTT client installed, version: ${version}`);
          });
        }
      }).catch((error: any) => {
        this.log(`MQTT client app error: ${error}`);
      });

  }

  register() {
    try {
      this.clientAvailable = true;
      // Subscribing to system topic to check if connection still alive (update ~10 second for mosquitto)
      /*let err = this.subscribeTopic("$SYS/broker/uptime");
      if (err) {
        this.log(`Error subscribing to system topic: $SYS/broker/uptime, error: ${JSON.stringify(err)}`);
        return;
      }*/
      this.lastMqttMessage = Date.now();
      let err = this.subscribeTopic("watts/+/measurement");
      if (err) {
        this.log(`Error subscribing to topic: watts/+/measurement, error: ${JSON.stringify(err)}`);
        return;
      }
      let now = Date.now();
      Object.keys(this.drivers).forEach((driverId) => {
        this.log(`Updating devices for driver: ${driverId}`);
        this.drivers[driverId].getDevices().forEach((device: { nextRequest: number; }) => {
          device.nextRequest = now;
        });
        this.drivers[driverId].updateDevices();
      });
    } catch (error) {
      if (this.debug)
        throw (error);
      else
        this.log(`${this.constructor.name} register error: ${error}`);
    }
  }

  unregister() {
    this.clientAvailable = false;
    this.lastMqttMessage = -1;
    this.log(`${this.constructor.name} unregister called`);
  }

  async onInit() {
    try {
      this.applicationVersion = Homey.manifest.version;
      this.debug = process.env.DEBUG === "1";
      this.applicationName = Homey.manifest.name.en;
    } catch (error) {
      this.applicationVersion = undefined;
      this.debug = false;
      this.applicationName = this.constructor.name;
    }
    process.on('unhandledRejection', (reason, p) => {
      this.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    });

    //Setup MQTT client
    this.topics = ["watts"];
    this.drivers = this.homey.drivers.getDrivers();
    this.lastMqttMessage = -1;
    this.clientAvailable = false;
    this.connectMqttClient();
    this.log(`${this.applicationName} is running. Version: ${this.applicationVersion}, debug: ${this.debug}`);
    setInterval(() => {
      try {
        if ((this.lastMqttMessage !== undefined) && (Date.now() - this.lastMqttMessage > 10 * 60 * 1000)) {
          this.log(`MQTT connection timeout. Resetting connection`);
          this.lastMqttMessage = -1;
          this.connectMqttClient();
        }
      } catch (error) {
        if (this.debug)
          throw (error);
        else
          this.log(`${this.constructor.name} checkDevices error: ${error}`);
      }
    }, 60000);
  }
}

module.exports = WattsLiveApp;
