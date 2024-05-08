import Homey from 'homey';
import { MeterReading, KvMap } from './types';

export class WattsLiveDevice extends Homey.Device {
  private nextRequest: number | undefined = undefined;
  private updateInterval: number = 10000;
  private debug: any;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {

    this.log('WattsLiveDevice has been initialized');
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

      const kMap: KvMap = {
        'meter_power': readings.positive_active_energy / 1000,
        'measure_power': readings.positive_active_power,
        'measure_power_l1': readings.positive_active_power_l1,
        'measure_power_l2': readings.positive_active_power_l2,
        'measure_power_l3': readings.positive_active_power_l3,
        'measure_current_l1': readings.current_l1,
        'measure_current_l2': readings.current_l2,
        'measure_current_l3': readings.current_l3,
        'measure_voltage_l1': readings.voltage_l1,
        'measure_voltage_l2': readings.voltage_l2,
        'measure_voltage_l3': readings.voltage_l3,
        'measure_negative_active_energy': readings.negative_active_energy / 1000,
        'measure_negative_active_power': readings.negative_active_power,
        'measure_negative_power_l1': readings.negative_active_power_l1,
        'measure_negative_power_l2': readings.negative_active_power_l2,
        'measure_negative_power_l3': readings.negative_active_power_l3,
        'measure_negative_reactive_energy': readings.negative_reactive_energy / 1000,
        'measure_negative_reactive_power': readings.negative_reactive_power,
        'measure_positive_reactive_energy': readings.positive_reactive_energy / 1000,
        'measure_positive_reactive_power': readings.positive_reactive_power
      };

      Object.keys(kMap).forEach(key => {
        if (this.hasCapability(key)) {
          this.setCapabilityValue(key, kMap[key]);
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
      'measure_negative_active_energy',
      'measure_negative_active_power',
      'measure_negative_power_l1',
      'measure_negative_power_l2',
      'measure_negative_power_l3',
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
    } else {
      this.log('Removing production capabilities')
      for (let capability of production_capabilities) {
        if (this.getCapabilities().includes(capability)) {
          await this.removeCapability(capability).catch((error) => { if (this.debug) throw (error); else this.log(`onSettings: removeCapability ${error}`); });
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

    if (event.changedKeys.includes('include_production')) {
      this.log(`onSettings: include_production ${event.newSettings['include_production']}`);
      await this.updateProductionCapabilities(event.newSettings['include_production']).catch((error) => { if (this.debug) throw (error); else this.log(`onSettings: updateProductionCapabilities ${error}`); });
    };
  }

  invalidateStatus(arg0: string) {
    throw new Error('Method not implemented.');
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
