'use strict';

import Homey, { ApiApp } from 'homey';
import { Driver } from 'homey/lib/Device';
import { DriverSettings } from './drivers/watts-live/DriverSettings';

export class WattsLiveApp extends Homey.App {
  
  private drivers: any = {};
  private applicationVersion: any;
  private debug: boolean = false;
  private applicationName: string = this.homey.manifest.name.en;
  
  async onInit() {
    try {
      this.applicationVersion = Homey.manifest.version;
      this.debug = process.env.DEBUG === "1";
      this.applicationName = Homey.manifest.name.en;
    } catch (error) {
      this.applicationVersion = undefined;
      this.debug = false;
      this.applicationName = this.constructor.name;
    }
    process.on('unhandledRejection', (reason, p) => {
      this.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    });
    
    //Update settings for devices that don't have any due to migration
    let drivers = this.homey.drivers.getDrivers();
    Object.keys(drivers).forEach((driverId) => {
      let devices = drivers[driverId].getDevices();
      devices.forEach(device => {
        let deviceSettings = device.getSettings();
        if(Object.keys(deviceSettings).includes("useMqttClient")===false){
          this.log(`Creating settings for driver ${device}`);
          device.setSettings(this.migrateSettings(deviceSettings.deviceId));
        }
      });
    });
  };

  private migrateSettings(deviceId: string): DriverSettings {
    return  {
      deviceId: deviceId,
      clientId: deviceId,
      useMqttClient: true,
      hostname: "",
      port: 1418,
      username: "",
      password: "",
      useTls: false,
      caCertificate: "",
      clientCertificate: "",
      clientKey: "",
      rejectUnauthorized: true
    }
  }
  
}


module.exports = WattsLiveApp;
