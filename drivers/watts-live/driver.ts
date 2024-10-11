import Homey from 'homey';
import { DriverSettings } from '../../types/DriverSettings';
import { MqttWrapper } from '../../lib/MqttWrapper';

class WattsLiveDriver extends Homey.Driver {
  private mqttWrapper: MqttWrapper | null = null;
  private topic:string = "watts/+/measurement";
  private devices:any[] = [];
  private discoveredDevices:any[] = [];

  
  /**
  * Called when pairing starts.
  */
  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    // Handler for the MQTT connection method selection
    session.setHandler('choose_mqtt_method', async (settings: DriverSettings) => {
      // Create an instance of DriverSettings based on the emitted data
      const driverSettings = new DriverSettings(settings);
        
      try {
        // Initialize MqttWrapper with Homey.app["homey"] and the constructed DriverSettings
        this.mqttWrapper = new MqttWrapper(this.homey, driverSettings);
        await this.mqttWrapper.connect();
    
        // Proceed to the next step if successful
        return true;
      } catch (err: any) {
        throw new Error(`MQTT connection failed: ${err.message}`);
      }
    });
  
    // Handler for starting device discovery
    session.setHandler('start_discovery', async (data) => {
      try {
        if (!this.mqttWrapper) {
          throw new Error('MQTT wrapper is not initialized');
        }
    
        // Start discovering devices using the topic
        this.devices = await this.mqttWrapper.discoverDevices(this.topic);    
        this.discoveredDevices = this.devices.map(device => ({
          id: device.id,
          name: device.name,
          data: {}
        }));
        // Return a successful response
        return true;
      } catch (err: any) {
        throw new Error(`Failed to discover devices: ${err.message}`);
      }
    });
  
    // Handler to get the list of discovered devices
    session.setHandler('get_devices', async () => {
      // Return the list of discovered devices
      this.homey.log(`Returning discovered devices: ${JSON.stringify(this.devices)}`);
      return this.discoveredDevices;
    });
  
    // Handler to add a selected device to Homey
    session.setHandler('add_device', async (device) => {
      // Handle adding the device (you can implement your logic here)
      return device;  // Return the device being added
    });
  }
  
  
  
  /**
  * Helper method to create a DriverSettings object from the pairing data.
  */
  /*
  private createDriverSettingsFromData(data: any): DriverSettings {
    return new DriverSettings({
      hostname: data.hostname || 'localhost',
      port: Number(data.port) || 1883,
      clientId: data.clientId || 'homey-watts',
      username: data.username || '',
      password: data.password || '',
      useTls: data.useTls === 'true',
      useHomeyMqttClient: data.useHomeyMqttClient || 'homey',
    });
  }
    */
}

module.exports = WattsLiveDriver;
