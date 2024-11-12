'use strict';

import Homey from 'homey';
import DriverSettings from '../../types/DriverSettings';
import MqttWrapper from '../../lib/MqttWrapper';

class WattsLiveDriver extends Homey.Driver {
  private mqttWrapper: MqttWrapper | null = null;
  readonly topic: string = 'watts/+/measurement';
  readonly devices: any[] = [];
  private discoveredDevices: any[] = [];
  private driverSettings: DriverSettings | undefined = undefined;

  async onInit(): Promise<void> {
    process.on('unhandledRejection', (reason, p) => {
      this.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    });
  }
  /**
  * Called when pairing starts.
  */
  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    // Check if the ApiApp is installed
    // Try making a request to the ApiApp service
    let apiAppAvailable = false;


    try {
      // Try to communicate with the ApiApp using an API request, if available
      apiAppAvailable = await this.homey.apps.getInstalled(
        this.homey.api.getApiApp('nl.scanno.mqtt'),
      );
      //apiAppAvailable = response !== null;
      this.log('ApiApp available : ', apiAppAvailable);
    } catch (err: any) {
      this.log('ApiApp not available:', err.message);
      apiAppAvailable = false;
    }

    // Continue with the pairing view
    await session.showView('choose_mqtt_method').then(_ => {
      if (!apiAppAvailable) {
        // Emit to disable the Homey MQTT Client option in the pairing flow
        session.emit('disable_homey_mqtt_option', { disable: true });
      }
    });

    session.setHandler('error', async (errorMessage: string) => {
      // Emit a view notification in response to the error event
      await session.emit('showViewNotification', {
        type: 'error',
        message: errorMessage,
      });
    });

    // Handler for the MQTT connection method selection
    session.setHandler(
      'choose_mqtt_method',
      async (settings: DriverSettings) => {
        // Create an instance of DriverSettings based on the emitted data
        this.driverSettings = new DriverSettings(settings);
        this.log(settings);
        try {
          // Initialize MqttWrapper with Homey.app['homey'] and the constructed DriverSettings
          this.mqttWrapper = new MqttWrapper(this.homey, this.driverSettings);
          await this.mqttWrapper.connect().then(_ => { return true }).catch(err => {
            this.homey.log('Selected pairing method failed :', this.driverSettings);
            session.emit('showViewNotification', { type: 'error', message: err.message || 'An unexpected error occurred during pairing.', });
            this.mqttWrapper = null;
            throw new Error(err.message);

          });
          // Proceed to the next step if successful
        } catch (err: any) {
          this.homey.log(err);
          this.mqttWrapper = null;
          throw new Error(`MQTT connection failed: ${err.message}`);
        }
      },
    );

    // Handler for starting device discovery
    session.setHandler('start_discovery', async (data) => {
      try {
        if (this.mqttWrapper === null) {
          throw new Error('MQTT wrapper is not initialized');
        }

        // Start discovering devices using the topic
        let discoveredDevices = await this.mqttWrapper.discoverDevices(
          this.topic,
        );
        this.mqttWrapper.disconnect();
        // Fetch already paired devices from Homey SDK
        const pairedDevices = await this.getPairedDevices();

        // Filter out paired devices and ensure unique devices
        const uniqueDiscoveredDevices = discoveredDevices
          .filter((device) => {
            // Exclude already paired devices
            return !pairedDevices.some(
              (pairedDevice: { id: any }) => pairedDevice.id === device.id,
            );
          })
          .reduce(
            (acc, device) => {
              // Ensure the device is unique based on its id
              if (!acc.some((d: { id: any }) => d.id === device.id)) {
                acc.push(device);
              }
              return acc;
            },
            [] as Array<{ id: string; name: string }>,
          );

        // Store the unique, unpaired devices
        this.discoveredDevices = uniqueDiscoveredDevices.map(
          (device: { id: any; name: any; data: any; settings: any }) => ({
            id: device.id,
            name: device.name,
            data: { id: device.id },
            settings: this.createDriverSettingsFromData(
              device,
              this.driverSettings!,
            ),
          }),
        );
        this.log(this.discoveredDevices);

        // Return a successful response
        return true;
      } catch (err: any) {
        throw new Error(`Failed to discover devices: ${err.message}`);
      }
    });

    // Handler to get the list of discovered devices
    session.setHandler('list_devices', async () => {
      // Return the list of discovered devices
      this.homey.log(
        `Returning discovered devices: ${JSON.stringify(this.devices)}`,
      );
      return this.discoveredDevices;
    });

    // Handler to return the device data when pairing completes
    session.setHandler('get_device', async () => {
      try {
        // Prepare the device data to be added
        const newDevice = {
          name: 'WattsLive Device', // Use a dynamic name if needed
          data: {
            id: 'unique-device-id', // Assign a unique ID for the device
          },
          store: {
            settings: this.driverSettings, // Store MQTT settings or other configurations
          },
        };

        // Return the device data to complete the pairing process
        return newDevice;
      } catch (error) {
        this.log('Error returning device data:', error);
        throw error;
      }
    });
  }

  // Helper function to get already paired devices
  private async getPairedDevices() {
    // Assuming this.getDevices() returns the list of paired devices from Homey Pro
    const pairedDevices = this.getDevices();
    return pairedDevices.map((device) => ({
      id: device.getSetting('deviceId'),
    }));
  }

  /**
  * Helper method to create a DriverSettings object from the pairing data.
  */
  private createDriverSettingsFromData(
    device: { id: any; name: any; data: any; settings: any },
    settings: DriverSettings,
  ): DriverSettings {
    const newSettings = new DriverSettings(settings);
    newSettings.deviceId = device.id;
    return newSettings;
  }
}

module.exports = WattsLiveDriver;
