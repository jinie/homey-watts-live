import Homey from 'homey';
import { ReadingToCapabilityMap, MeterReading, KvMap } from './types';
import { DriverSettings } from './DriverSettings';

export class WattsLiveDevice extends Homey.Device {
  private nextRequest: number | undefined = undefined;
  private updateInterval: number = 30000;
  private debug: any;
  private settings: DriverSettings | undefined = undefined;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    //this.updateSettings();
    this.migrateCapabilities(); //Update capabilities from V1 to V2
    this.getSettings()
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


  updateSettings(){
    this.settings = JSON.parse(this.getSettings()) as DriverSettings;
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

  async onSettings(event: any) {
    if (this.debug)
      this.log(`onSettings: changes ${JSON.stringify(event.changedKeys)}`);

    if (event.changedKeys.includes('mqtt_topic')) {
      setTimeout(() => {
        this.nextRequest = Date.now();
        this.invalidateStatus(this.homey.__('device.unavailable.update'));
      }, 3000);
    };

    //this.updateSettings();
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

  /**
   * Migrate custom capabilities between versions.
   * No "official" way of migrating exists, so for now just delete the old capabiliy and add a new one.
   * This deletes history and may break flows, so don't make a habit of it.
   */
  async migrateCapabilities() {
    const caps:string[] = [
    'meter_power.exported',
    'measure_power.negative_active',
    'measure_power.l1',
    'measure_power.l2',
    'measure_power.l3',
    'measure_voltage.l1',
    'measure_voltage.l2',
    'measure_voltage.l3',
    'measure_current.l1',
    'measure_current.l2',
    'measure_current.l3',
    'measure_power.negative_l1',
    'measure_power.negative_l2',
    'measure_power.negative_l3',
    'measure_negative_reactive_energy',
    'measure_power.negative_reactive',
    'measure_positive_reactive_energy',
    'measure_power.positive_reactive'
    ]

    const removedCapabilities: string[] = [
      'measure_power_l1',
      'measure_power_l2',
      'measure_power_l3',
      'measure_voltage_l1',
      'measure_voltage_l2',
      'measure_voltage_l3',
      'measure_current_l1',
      'measure_current_l2',
      'measure_current_l3',
      'measure_negative_active_power',
      'measure_negative_power_l1',
      'measure_negative_power_l2',
      'measure_negative_power_l3'
    ];
    
    if(this.getCapabilities().includes("meter_power")){
      this.log("Removing meter_power capability");
      await this.removeCapability("meter_power").catch((error) => { if (this.debug) throw (error); else this.log(`migrateCapabilites, removeCapability error: ${error}`); });
      this.log("Adding meter_power.imported capability");
      await this.addCapability("meter_power.imported").catch((error) => { if (this.debug) throw (error); else this.log(`migrateCapabilites, addCapability error: ${error}`); });
    }
    if(this.getCapabilities().includes("measure_negative_active_energy")){
      this.log("removing measure_negative_active_energy capability");
      await this.removeCapability("measure_negative_active_energy").catch((error) => { if (this.debug) throw (error); else this.log(`migrateCapabilites, removeCapability error: ${error}`); });
      this.log("Adding metwer_power.exported capability");
      await this.addCapability("meter_power.exported").catch((error) => { if (this.debug) throw (error); else this.log(`migrateCapabilites, addCapability error: ${error}`); });    
    };

    await removedCapabilities.forEach(capability => {
      if(this.getCapabilities().includes(capability)===true)
        this.log(`Removing capability ${capability}`);
        this.removeCapability(capability).catch((error) => { if (this.debug) throw (error); else this.log(`migrateCapabilites, removeCapability error: ${error}`); });

    });
    
    await caps.forEach( capability =>{
      if(this.getCapabilities().includes(capability)===false)
        this.log(`Adding capability ${capability}`);
        this.addCapability(capability).catch((error) => { if (this.debug) throw (error); else this.log(`migrateCapabilites, Production addCapability error: ${error}`); });
    })
  }

};

module.exports = WattsLiveDevice;
