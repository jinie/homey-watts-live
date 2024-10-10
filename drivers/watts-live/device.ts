import Homey from 'homey';
import { ReadingToCapabilityMap, addedCapabilitiesV1toV2, removedCapabilitiesV1toV2 } from '../../lib/constants';
import { DriverSettings } from '../../types/DriverSettings';
import { MqttWrapper } from '../../lib/MqttWrapper';
import { KvMap } from '../../types/KvMap';
import { MeterReading } from '../../types/MeterReading';

export class WattsLiveDevice extends Homey.Device {
  
  private debug: any;
  private settings: DriverSettings | undefined = undefined;
  private mqttWrapper: MqttWrapper | null = null;
  private isConnected: boolean = false;
  
  /**
  * onInit is called when the device is initialized.
  */
  async onInit() {
    await this.migrateToNewMqttConnectivity();
    await this.migrateCapabilities(); //Update capabilities from V1 to V2

    // Get device-specific settings and create a DriverSettings object
    const driverSettings = this.getDeviceSettings();

    this.homey.log(`Initializing Device with settings : ${JSON.stringify(driverSettings)}`);
    // Initialize the MQTT wrapper with the device's settings
    this.mqttWrapper = new MqttWrapper(this.homey, driverSettings);
    await this.mqttWrapper.connect();
    
    // Subscribe to the relevant topic for this device
    const deviceId = driverSettings.deviceId;
    this.mqttWrapper.subscribe(`/watts/${deviceId}/measurement`, this.onMessage.bind(this));
    
    // Mark the device as connected
    this.isConnected = true;
    
    // Check initial device status
    await this.CheckDeviceStatus();
  }
  
  
  onMessage(topic: string, message: string | Buffer) {
    let msg:string = (typeof message === typeof Buffer ) ? message.toString() : message as string;
    this.log(`Message recieved ${msg}`)
    this.processMqttMessage(topic, msg);
  }
  
  /**
  * Called when the device is deleted from Homey.
  */
  async onDeleted(): Promise<void> {
    //this.log(`Device deleted: ${this.getName()} (${this.getData().id})`);
    
    // Perform cleanup by disconnecting MQTT and freeing any resources.
    if (this.mqttWrapper) {
      this.mqttWrapper.disconnect();
    }
  }
  
  /**
  * Called when the device is added to Homey.
  */
  async onAdded(): Promise<void> {
    //this.log(`Device added: ${this.getName()} (${this.getData().id})`);
    // This is where you can implement any setup logic after the device is paired or added.
    // For example, sending an MQTT message to let the server know this device was added
    const deviceId = this.getDeviceSettings().deviceId;
    this.log(`Device added: ${deviceId}`);
    // Optionally: Publish an MQTT message or perform any initialization specific to being added.
    this.setAvailable();
  }
  
  /**
  * onRenamed is called when the user updates the device's name.
  * This method can be used this to synchronise the name to the device.
  * @param {string} name The new name
  */
  async onRenamed(name: string) {
    this.log('WattsLiveDevice was renamed');
  }
  
  
  /**
  * Utility function to get device settings and return a DriverSettings object.
  */
  getDeviceSettings(): DriverSettings {
    const settings = this.getSettings();
    this.log(`Reading device settings ${JSON.stringify(settings)}`);
    // Construct and return a DriverSettings object using the device's settings
    return new DriverSettings({
      deviceId: settings.deviceId || '',
      hostname: settings.hostname || 'localhost',
      port: Number(settings.port) || 1883,
      clientId: settings.clientId || 'homey-watts',
      username: settings.username || '',
      password: settings.password || '',
      useTls: settings.useTls === 'true',
      useHomeyMqttClient: settings.useHomeyMqttClient || 'homey',
    });
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
  
  /**
  * Called when settings are changed via the Homey UI.
  * This method handles changes to settings and updates the device configuration accordingly.
  */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys
  }: {
    oldSettings: { [key: string]: string | number | boolean | null | undefined };
    newSettings: { [key: string]: string | number | boolean | null | undefined };
    changedKeys: string[];
  }): Promise<void> {
    this.log('Settings updated:', changedKeys);
    
    // Check if any MQTT-related settings have changed that require reconnecting
    const needsReconnect = changedKeys.some(key => [
      'hostname', 'port', 'clientId', 'username', 'password', 'useTls', 'useHomeyMqttClient', 'deviceId'
    ].includes(key));
    
    if (needsReconnect) {
      this.log('Reconnecting due to changed MQTT settings...');
      const driverSettings = this.getDeviceSettings();
      await this.reconnectMqtt(driverSettings);
    }
  }
  
  /**
  * Called when the device goes offline (e.g., MQTT disconnection or no response).
  */
  async onDeviceOffline(): Promise<void> {
    //this.log(`Device offline: ${this.getName()} (${this.getData().id})`);
    
    // Mark the device as unavailable in Homey
    this.setUnavailable('Device is offline or disconnected from MQTT server');
    
    // Clean up the MQTT connection
    if (this.mqttWrapper) {
      this.mqttWrapper.disconnect();
      this.isConnected = false;
    }
    
    // Optionally, you can set a retry mechanism to attempt reconnecting after a certain interval
    // For example:
    setTimeout(() => {
      this.log('Attempting to reconnect after going offline...');
      this.reconnectMqtt(); // Attempt to reconnect after a delay
    }, 60000); // Retry after 60 seconds (you can adjust the delay as needed)
  }
  
  /*
  onDeleted() {
  this.MqttService?.unregister();
  this.log("Unregistered device from MQTT Client")
  }*/
  
  getMqttTopic() {
    return this.getSettings()['deviceId'];
  }
  
  /**
  * Method to check the status of the device.
  * Typically verifies the connection and can check if the device is responsive.
  */
  async CheckDeviceStatus(): Promise<void> {
    if (!this.isConnected) {
      this.log('Device is not connected, attempting to reconnect...');
      await this.reconnectMqtt();
    }
    
    // You can add further status checks if necessary
    this.log('Device status checked and seems OK');
  }
  
  /**
  * Invalidate the device status, typically when the connection is lost or an error occurs.
  */
  invalidateStatus(): void {
    this.log('Device status invalidated');
    this.isConnected = false;
    this.setUnavailable('Device disconnected or unavailable');
  }
  
  /**
  * Helper method to reconnect the device to the MQTT server.
  * Handles disconnection and reconnection logic.
  */
  private async reconnectMqtt(newSettings?: DriverSettings): Promise<void> {
    if (this.mqttWrapper) {
      this.mqttWrapper.disconnect();
    }
    
    // Use new settings if provided, otherwise use current device settings
    const driverSettings = newSettings || this.getDeviceSettings();
    
    // Reinitialize the MQTT wrapper with the new settings
    const homeyApp = this.homey;
    this.mqttWrapper = new MqttWrapper(homeyApp,driverSettings);
    await this.mqttWrapper.connect();
    
    // Re-subscribe to the device's topic
    const deviceId = this.getDeviceSettings().deviceId;
    this.mqttWrapper.subscribe(`/watts/${deviceId}/measurement`, this.onMessage.bind(this));
    
    this.isConnected = true;
    this.setAvailable();
  }
  
  async migrateToNewMqttConnectivity(): Promise<void> {
    try {
      // Get the current settings of the device
      const settings = this.getSettings();

      // Check if the `useHomeyMqttClient` key is missing, indicating the old format
      if (!settings.useHomeyMqttClient) {
        this.log(`Migrating device ${this.getData().id} to the new MQTT connectivity...`);

        // Set the new settings for MQTT, use "homey" or "custom" instead of a boolean
        const newSettings = {
          hostname: 'localhost', // Default value for Homey MQTT Client
          port: 1883, // Default MQTT port for Homey MQTT Client
          clientId: `homey-device-${this.getData().id}`, // Unique clientId based on the device ID
          username: '', // Not needed for Homey MQTT Client
          password: '', // Not needed for Homey MQTT Client
          useTls: false, // Not needed for Homey MQTT Client
          useHomeyMqttClient: 'homey', // Set this to "homey" to match the dropdown value
          mqttTopic: `/watts/${settings.deviceId}/measurement` // Default MQTT topic based on deviceId
        };

        // Apply the new settings to the device
        await this.setSettings(newSettings);

        this.log(`Device ${this.getData().id} successfully migrated to the new MQTT connectivity.`);
      } else {
        this.log(`Device ${this.getData().id} is already using the new MQTT connectivity.`);
      }
    } catch (error) {
      this.error(`Error migrating device ${this.getData().id}:`, error);
    }
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
