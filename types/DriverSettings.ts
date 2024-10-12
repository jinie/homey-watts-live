export class DriverSettings {
  public deviceId: string = '';
  public hostname: string = 'localhost';
  public port: number = 1883;
  public clientId: string = 'homey-watts';
  public username: string = '';
  public password: string = '';
  public useTls: boolean = false;
  public useHomeyMqttClient: string = "homey";
  public acceptSelfSignedCert: boolean = false;  // New setting for self-signed certificates

  constructor(settings?: Partial<DriverSettings>) {
    if (settings) {
      Object.assign(this, settings);
    }
  }
}
