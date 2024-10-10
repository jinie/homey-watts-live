'use strict';

import Homey, { ApiApp } from 'homey';
import { Driver } from 'homey/lib/Device';
import { DriverSettings } from './types/DriverSettings';

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
  };
  

};


module.exports = WattsLiveApp;
