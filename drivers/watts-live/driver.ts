import Homey from 'homey';
import { PairSession } from 'homey/lib/Driver';
import { ReadingToCapabilityMap, MessagesCollected, MeterReading, Capabilities } from './types';
import { DriverSettings } from './DriverSettings';
const WattsLiveDevice = require('./device');
import { MqttClient } from 'mqtt';




export class WattsLiveDriver extends Homey.Driver {

  private deviceConnectionTrigger: any;
  private devicesCounter: number | undefined = undefined;
  private searchingDevices = false;
  private messagesCounter = 0;
  private messagesCollected: MessagesCollected = {};
  private topicsToIgnore: string[] = [];
  private debug: boolean = false;
  private config: DriverSettings | undefined = undefined;
  private MQTTClient: Homey.ApiApp | undefined= undefined;
  private MQTTClient_native: MqttClient | undefined = undefined;

 
  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log(`${this.constructor.name} has been initiated, driver id: ${this.manifest.id}, driver name: ${this.manifest.name.en}`);
    setInterval(() => {
      try {
        this.updateDevices();
      } catch (error) {
        if (this.debug)
          throw (error);
        else
          this.log(`${this.constructor.name} checkDevices error: ${error}`);
      }
    }, 30000);
    this.log('WattsLiveDriver has been initialized');
  }

  collectPairingData(topic: string, message: string) {
    let topicParts = topic.split('/');
    if (this.messagesCollected[topicParts[1]] === undefined)
      this.messagesCollected[topicParts[1]] = {
        messages: []
      };

    this.messagesCollected[topicParts[1]].messages.push(message);
  }

  getTopicsToIgnore() {
    let result: string[] = [];
    (this.getDevices() as typeof WattsLiveDevice[]).forEach(device => {
      result.push(device.getMqttTopic());
    });
    return result;
  }

  updateDevices() {
    this.getDevices().forEach(device => {
      (device as typeof WattsLiveDevice).checkDeviceStatus();
    });
  }

  public async onDeviceStatusChange(device: { getName: () => any; getData: () => { (): any; new(): any; id: any; }; }, newStatus: string, oldStatus: string) {
    if ((oldStatus === 'unavailable') && (newStatus === 'available')) {
      this.deviceConnectionTrigger.trigger({
        name: device.getName(),
        device_id: device.getData().id,
        status: true
      });
    } else if ((oldStatus === 'available') && (newStatus === 'unavailable')) {
      this.deviceConnectionTrigger.trigger({
        name: device.getName(),
        device_id: device.getData().id,
        status: false
      });
    }
  }

  checkDeviceSearchStatus() {
    this.log(`checkDeviceSearchStatus: ${this.devicesCounter} === ${Object.keys(this.messagesCollected).length}`);
    if (this.devicesCounter === undefined)
      this.devicesCounter = 0;
    let devCount = Object.keys(this.messagesCollected).length;
    if (devCount === this.devicesCounter) {
      this.devicesCounter = undefined;
      return true;
    }
    this.devicesCounter = devCount;
    return false;
  }

  sendMessageToDevices(topic: string, message: string) {
    let topicParts = topic.split('/');
    let devices = this.getDevices();
    for (const element of devices) {
      let device = element as typeof WattsLiveDevice;
      if (device.getMqttTopic() === topicParts[1]) {
        device.onMessage(topic, message);
        break;
      }
    }
  }

  onMessage(topic: string, message: any) {
    try {
      if (this.searchingDevices) {
        this.messagesCounter++;
        this.collectPairingData(topic, message);
      }
      this.sendMessageToDevices(topic, message);
    } catch (error) {
      if (this.debug)
        throw (error);
      else
        this.log(`onMessage error: ${error}`);
    }
  }

  async onPair(session: PairSession): Promise<void> {
    let driver = this;
    let devices: any[] = [];
    session.setHandler('list_devices', async (data) => {
      driver.log(`list_devices: ${JSON.stringify(data)}`);
      if (devices.length === 0) {
        if (driver.messagesCounter === 0)
          return Promise.reject(new Error(driver.homey.__('mqtt_client.no_messages')));
        else
          return Promise.reject(new Error(driver.homey.__('mqtt_client.no_new_devices')));
      }
      driver.log(`list_devices: New devices found: ${JSON.stringify(devices)}`);
      return devices;
    });
    session.setHandler("list_devices_selection", async (devices) => {
      driver.log(`list_devices_selection: ${JSON.stringify(devices)}`);
    });
    session.setHandler('showView', async (viewId) => {
      driver.log(`onPair current phase: "${viewId}"`);
      if (viewId === 'loading') {
        this.messagesCounter = 0;
        this.searchingDevices = true;
        this.topicsToIgnore = this.getTopicsToIgnore();
        this.log(`Topics to ignore during pairing: ${JSON.stringify(this.topicsToIgnore)}`);
        let interval = setInterval((drvArg, sessionArg) => {
          if (drvArg.checkDeviceSearchStatus()) {
            clearInterval(interval);
            this.searchingDevices = false;
            devices = drvArg.pairingFinished(this.messagesCollected);
            this.messagesCollected = {};
            sessionArg.emit('list_devices', devices);
            sessionArg.nextView();
          }
        }, 7000, driver, session);
      }
    });
  }

  collectedDataToDevice(deviceTopic: string, messages: string[]): {} | null {
    let readings: MeterReading[] = [];
    readings.forEach((message) => {
      try {
        readings.push(JSON.parse(JSON.stringify(message)) as MeterReading);
      } catch (error) {
        if (this.debug)
          throw (error);
        else
          this.log(`collectedDataToDevice error: ${error}`);
      }
    });
    // look through readings and find any keys that are undefined
    let undefinedKeys: string[] = [];
    
    readings.forEach((reading) => {
      for (const key in ReadingToCapabilityMap) {
        if (reading[key as keyof MeterReading] === undefined) {
          undefinedKeys.push(ReadingToCapabilityMap[key]);
        }
      }
    });


    let caps = Capabilities;

    undefinedKeys.forEach((key) => {
      if (caps.includes(key)) {
        caps.splice(caps.indexOf(key), 1);
      }
    });

    let devItem = {
      name: "Watts Live",
      data: {
        id: deviceTopic,
      },
      settings: {
        deviceId: deviceTopic,
        include_production: false,
      },
      capabilities: caps,
      capabilitiesOptions: {},
      class: 'other'
    };
    if (devItem.capabilities.length <= 1)
      return null;
    return devItem;
  }

  pairingFinished(messagesCollected: MessagesCollected): Object[] {
    this.log('pairingFinished called');
    let devices: Object[] = [];
    Object.keys(messagesCollected).sort().forEach(key => {
      let devItem = this.collectedDataToDevice(key, messagesCollected[key].messages);
      if (devItem !== null)
        devices.push(devItem);
    });
    this.log(`pairingFinished: devices found ${JSON.stringify(devices)}`);
    return devices;
  }
};


module.exports = WattsLiveDriver;
