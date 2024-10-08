import Homey, {ApiApp} from 'homey';
import { ReadingToCapabilityMap, MeterReading, KvMap, addedCapabilitiesV1toV2, removedCapabilitiesV1toV2 } from './types';
import { DriverSettings } from './DriverSettings';
import { MqttClient } from 'mqtt';
import { MqttService } from '../../lib/MqttService';

export class WattsLiveDevice extends Homey.Device {

  private debug: any;
  private settings: DriverSettings | undefined = undefined;
  private MqttService: MqttService | undefined;
  //private MqttClient_app: ApiApp | undefined = undefined; //MQTT Client App
  //private MqttClient_native: MqttClient | undefined = undefined; // Native MQTT 

  /**
  * onInit is called when the device is initialized.
  */
  async onInit() {
    this.migrateCapabilities(); //Update capabilities from V1 to V2
    this.updateSettings();
    this.MqttService = new MqttService(this.homey, this.debug);
    await this.MqttService.connectToMqtt(this.settings!);

    this.MqttService
    .on('realtime', (topic: string, message: string) => { this.onMessage(topic, message); })
    .on('disconnect',() => { this.invalidateStatus('disconnected'); })
    .on('connect',() => { this.setAvailable()})
    ;

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
    let settings = this.getSettings();
    this.settings = {
      "deviceId": settings.deviceId,
      "clientId": settings.deviceId,
      "useMqttClient": settings.mqttClient === 'builtin' ? false : true,
      "hostname": settings.server,
      "port": settings.port,
      "username": settings.username,
      "password": settings.password,
      "useTls": settings.useTLS,
      "caCertificate": settings.ca,
      "clientCertificate": settings.cert,
      "clientKey": settings.key,
      "rejectUnauthorized": settings.rejectUnauthorized
    };
    if(this.debug){
      this.log(`UpdateSettings : ${settings}`);
    }
  }
  
  onDeviceOffline() {
    this.invalidateStatus(this.homey.__('device.unavailable.offline'));
  }
   
  
  public onMessage(topic: string, message: string){
    if(this.debug){
      this.log(`Device Message recieved:${topic} - ${message}`)
    }
    let topicParts = topic.split('/');
    if (topicParts.length > 1) {
      this.processMqttMessage(topic, message).catch((error) => { if (this.debug) throw (error); else this.log(`onMessage error: ${error}`); });
    }
  }
  
  public async processMqttMessage(topic: string, message: string) {
    try {
      // Extract device id from topic where device id is /watts/<device_id>/measurement
      const readings: MeterReading = JSON.parse(JSON.stringify(message));
      
      // Map readings to capabilities, convert undefined to 0
      let kMap: KvMap = {};
      Object.keys(ReadingToCapabilityMap).forEach((value) => {
        let key = ReadingToCapabilityMap[value];
        kMap[key] = readings[value as unknown as keyof MeterReading] ?? 0;
        // Convert from Watts to kW
        if(['meter_power.imported', 'meter_power.exported', 'meter_power.negative_reactive', 'meter_power.positive_reactive'].includes(key)) {
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
        this.invalidateStatus(this.homey.__('device.unavailable.update'));
      }, 3000);
    };
    
    //this.updateSettings();
  }
  
  invalidateStatus(arg0: string) {
    this.setUnavailable(arg0);
    this.MqttService?.connectMqttClient(this.settings!);
  }
  
  onDeleted() {
    this.MqttService?.unregister();
    this.log("Unregistered device from MQTT Client")
  }
  
  getMqttTopic() {
    return this.getSettings()['deviceId'];
  }
  
  checkDeviceSearchStatus(): boolean {
    return true;
  }
  
  checkDeviceStatus(): boolean {
    // return true if device is online and next request time is in the future
    if (this.MqttService?.nextRequest === undefined) {
      return false;
    }
    return Date.now() > this.MqttService?.nextRequest;
  }
  
  /**
  * Migrate custom capabilities between versions.
  * No "official" way of migrating exists, so for now just delete the old capabiliy and add a new one.
  * This deletes history and may break flows, so don't make a habit of it.
  */
  async migrateCapabilities() {
    
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
    
    await removedCapabilitiesV1toV2.forEach(capability => {
      if(this.getCapabilities().includes(capability)===true)
        this.log(`Removing capability ${capability}`);
      this.removeCapability(capability).catch((error) => { if (this.debug) throw (error); else this.log(`migrateCapabilites, removeCapability error: ${error}`); });
      
    });
    
    await addedCapabilitiesV1toV2.forEach( capability =>{
      if(this.getCapabilities().includes(capability)===false)
        this.log(`Adding capability ${capability}`);
      this.addCapability(capability).catch((error) => { if (this.debug) throw (error); else this.log(`migrateCapabilites, Production addCapability error: ${error}`); });
    })
  }
  
};

module.exports = WattsLiveDevice;
