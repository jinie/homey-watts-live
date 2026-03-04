/* eslint-disable import/no-unresolved */

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
          this.log(settings);

          // Initialize MqttWrapper with Homey.app['homey'] and the constructed DriverSettings
          this.mqttWrapper = new MqttWrapper(this.homey, this.driverSettings);

          // Enforce a timeout so the pairing UI gets an error response instead of hanging.
          const connectTimeoutMs = 10000;
          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          try {
            await Promise.race([
              this.mqttWrapper.connect(),
              new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                  reject(new Error(`MQTT connection timeout after ${connectTimeoutMs}ms`));
                }, connectTimeoutMs);
              }),
            ]);
          } finally {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
          }
          // Proceed to the next step if successful
        } catch (err: any) {
          this.homey.log('Selected pairing method failed :', this.driverSettings);
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
    session.setHandler('start_discovery', async (data) => {
      try {
        if (this.mqttWrapper === null) {
          throw new Error('MQTT wrapper is not initialized');
        }

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
              (pairedDevice: { id: string }) => pairedDevice.id === device.id,
            );
          })
          .reduce(
            (acc, device) => {
              // Ensure the device is unique based on its id
              if (!acc.some((d: { id: string }) => d.id === device.id)) {
                acc.push(device);
              }
              return acc;
            },
            [] as Array<{ id: string; name: string }>,
          );

        // Store the unique, unpaired devices
        this.discoveredDevices = uniqueDiscoveredDevices.map(
          (device: { id: string; name: string; data: object; settings: object }) => ({
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
      } catch (err:any) {
        throw new Error(`Failed to discover devices: ${err.message}`);
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
    device: { id: string; name: string; data: object; settings: object },
    settings: DriverSettings,
  ): DriverSettings {
    const newSettings = new DriverSettings(settings);
    newSettings.deviceId = device.id;
    return newSettings;
  }
}

module.exports = WattsLiveDriver;
