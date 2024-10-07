import Homey from 'homey';
import { ReadingToCapabilityMap, MeterReading, KvMap } from './types';

export class WattsLiveDevice extends Homey.Device {
  private nextRequest: number | undefined = undefined;
  private updateInterval: number = 30000;
  private debug: any;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {

    this.log('WattsLiveDevice has been initialized');
    this.updateProductionCapabilities(true); // Add production capabilities to all devices and remove option to disable them.
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('WattsLiveDevice has been added');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('WattsLiveDevice was renamed');
  }

  onDeviceOffline() {
    this.invalidateStatus(this.homey.__('device.unavailable.offline'));
    this.nextRequest = Date.now() + this.updateInterval;
  }

  onMessage(topic: string, message: string) {
    let topicParts = topic.split('/');
    if (topicParts.length < 3) {
      return;
    }
    this.processMqttMessage(topic, message).catch((error) => { if (this.debug) throw (error); else this.log(`onMessage error: ${error}`); });
  }

  async processMqttMessage(topic: string, message: string) {
    try {
      // Extract device id from topic where device id is /watts/<device_id>/measurement
      const readings: MeterReading = JSON.parse(JSON.stringify(message));
      this.nextRequest = Date.now() + this.updateInterval;

      // Map readings to capabilities, convert undefined to 0
      let kMap: KvMap = {};
      Object.keys(ReadingToCapabilityMap).forEach((value) => {
        let key = ReadingToCapabilityMap[value];
        kMap[key] = readings[value as unknown as keyof MeterReading] ?? 0;
        // Convert from Watts to kW
        if(['meter_power.imported', 'meter_power.exported', 'measure_negative_reactive_energy', 'measure_positive_reactive_energy'].includes(key)) {
          kMap[key] = (kMap[key] ?? 0) / 1000;
        }
      });
    
      // Set capabilities
      Object.keys(kMap).forEach(key => {
        if (this.hasCapability(key) && kMap[key] !== undefined) {
          this.setCapabilityValue(key, kMap[key] as number);
        }
      });


    } catch (error: any) {
      if (this.debug)
        throw (error);
      else
        this.log(`processMqttMessage error: ${error}`);
    }
  }

  async updateProductionCapabilities(enable: boolean) {
    let production_capabilities: string[] = [
      'meter_power.exported',
      'measure_negative_active_power',
      'measure_negative_power.l1',
      'measure_negative_power.l2',
      'measure_negative_power.l3',
      'measure_negative_reactive_energy',
      'measure_negative_reactive_power',
      'measure_positive_reactive_energy',
      'measure_positive_reactive_power'
    ];
    if (enable) {
      this.log('Adding production capabilities')
      for (let capability of production_capabilities) {
        if (!this.getCapabilities().includes(capability)) {
          await this.addCapability(capability).catch((error) => { if (this.debug) throw (error); else this.log(`onSettings: addCapability ${error}`); });
        }
      };
    }
  }

  async onSettings(event: any) {
    if (this.debug)
      this.log(`onSettings: changes ${JSON.stringify(event.changedKeys)}`);

    if (event.changedKeys.includes('mqtt_topic')) {
      setTimeout(() => {
        this.nextRequest = Date.now();
        this.invalidateStatus(this.homey.__('device.unavailable.update'));
      }, 3000);
    };
  }

  invalidateStatus(arg0: string) {
    this.setUnavailable(arg0);
  }

  onDeleted() {
  }

  getMqttTopic() {
    return this.getSettings()['deviceId'];
  }

  checkDeviceSearchStatus(): boolean {
    return true;
  }

  checkDeviceStatus(): boolean {
    // return true if device is online and next request time is in the future
    if (this.nextRequest === undefined) {
      return false;
    }
    return Date.now() > this.nextRequest;
  }
};

module.exports = WattsLiveDevice;
