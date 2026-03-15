/* eslint-disable import/no-unresolved */

'use strict';

import Homey from 'homey';
import DriverSettings from '../../types/DriverSettings';
import MqttWrapper from '../../lib/MqttWrapper';
import DiscoveredDevice from '../../types/DiscoveredDevice';

interface PairedDevice {
  id: string;
}

interface PairableDevice {
  id: string;
  name: string;
  data: {
    id: string;
  };
  settings: DriverSettings;
}

class WattsLiveDriver extends Homey.Driver {

  private mqttWrapper: MqttWrapper | null = null;
  readonly topic: string = 'watts/+/measurement';
  readonly devices: PairableDevice[] = [];
  private discoveredDevices: PairableDevice[] = [];
  private driverSettings: DriverSettings | undefined = undefined;
  private isPairingConnectionInProgress: boolean = false;

  async onInit(): Promise<void> {
    this.log('WattsLiveDriver initialized');
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
      const mqttApiApp = this.homey.api.getApiApp('nl.scanno.mqtt');
      apiAppAvailable = await mqttApiApp.getInstalled();
      this.log('ApiApp available : ', apiAppAvailable);
    } catch (err: any) {
      this.log('ApiApp not available:', err.message);
      apiAppAvailable = false;
    }

    // Continue with the pairing view
    await session.showView('choose_mqtt_method');

    session.setHandler('get_api_state', async () => ({
      apiAppAvailable,
    }));

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
        if (this.isPairingConnectionInProgress) {
          throw new Error('A connection attempt is already in progress');
        }

        this.isPairingConnectionInProgress = true;

        if (apiAppAvailable === false && settings.useHomeyMqttClient === 'homey') {
          this.isPairingConnectionInProgress = false;
          throw new Error('MQTT Client App is not installed');
        }

        try {
          // Ensure previous attempt is fully cleaned up before trying again.
          if (this.mqttWrapper) {
            await this.mqttWrapper.disconnect().catch((error) => {
              this.homey.log('Error while cleaning up previous pairing connection', error);
            });
            this.mqttWrapper = null;
          }

          // Create an instance of DriverSettings based on the emitted data
          this.driverSettings = new DriverSettings(settings);
          const validationErrors = this.driverSettings.validate();
          if (validationErrors.length > 0) {
            throw new Error(validationErrors[0]);
          }
          this.log(`Pairing settings: ${this.driverSettings.toSafeJSON()}`);
        } catch (err: any) {
          this.homey.log(`Selected pairing method failed: ${this.driverSettings?.toSafeJSON()}`);
          if (this.mqttWrapper) {
            await this.mqttWrapper.disconnect().catch((disconnectError) => {
              this.homey.log('Error during failed pairing cleanup', disconnectError);
            });
            this.mqttWrapper = null;
          }
          throw new Error(`MQTT connection failed: ${err.message || 'Unknown error'}`);
        } finally {
          this.isPairingConnectionInProgress = false;
        }
      },
    );

    // Handler for starting device discovery
    session.setHandler('start_discovery', async () => {
      try {
        if (!this.driverSettings) {
          throw new Error('Pairing settings are not initialized');
        }

        if (this.mqttWrapper === null) {
          this.mqttWrapper = new MqttWrapper(this.homey, this.driverSettings);
        }

        await this.mqttWrapper.connect();

        // Start discovering devices using the topic
        const discoveredDevices = await this.mqttWrapper.discoverDevices(
          this.topic,
        );
        this.homey.log(`discovered devices : ${discoveredDevices}`);
        await this.mqttWrapper.disconnect();
        this.mqttWrapper = null;
        // Fetch already paired devices from Homey SDK
        const pairedDevices = await this.getPairedDevices();

        // Filter out paired devices and ensure unique devices
        const uniqueDiscoveredDevices = discoveredDevices
          .filter((device) => {
            // Exclude already paired devices
            return !pairedDevices.some(
              (pairedDevice: PairedDevice) => pairedDevice.id === device.id,
            );
          })
          .reduce(
            (acc: DiscoveredDevice[], device: DiscoveredDevice) => {
              // Ensure the device is unique based on its id
              if (!acc.some((d) => d.id === device.id)) {
                acc.push(device);
              }
              return acc;
            },
            [],
          );

        // Store the unique, unpaired devices
        this.discoveredDevices = uniqueDiscoveredDevices.map(
          (device: DiscoveredDevice): PairableDevice => ({
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
      } catch (err: unknown) {
        if (this.mqttWrapper) {
          await this.mqttWrapper.disconnect().catch((disconnectError) => {
            this.homey.log('Error during failed discovery cleanup', disconnectError);
          });
          this.mqttWrapper = null;
        }
        throw new Error(`Failed to discover devices: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // Handler to get the list of discovered devices
    session.setHandler('list_devices', async () => {
      // Return the list of discovered devices
      this.homey.log(
        `Returning discovered devices: ${JSON.stringify(this.discoveredDevices)}`,
      );
      return this.discoveredDevices;
    });

    // Handler to return the device data when pairing completes
    session.setHandler('get_device', async () => {
      if (this.discoveredDevices.length === 0) {
        throw new Error('No devices discovered during pairing');
      }
      return this.discoveredDevices[0];
    });
  }

  // Helper function to get already paired devices
  private async getPairedDevices(): Promise<PairedDevice[]> {
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
    device: DiscoveredDevice,
    settings: DriverSettings,
  ): DriverSettings {
    const newSettings = new DriverSettings(settings);
    newSettings.deviceId = device.id;
    return newSettings;
  }
}

module.exports = WattsLiveDriver;
