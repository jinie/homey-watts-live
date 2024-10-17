export default class DriverSettings {
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
  
  // Method to return a JSON string with masked username and password
  toSafeJSON(): string {
    const maskedSettings = {
      ...this, // Spread the current instance's properties
      username: this.username ? '*'.repeat(this.username.length) : '',
      password: this.password ? '*'.repeat(this.password.length) : '',
    };
    
    return JSON.stringify(maskedSettings, null, 2); // Pretty print with indentation
  }
  
  static driverSettingsDefault(deviceId: string): DriverSettings{
    let settings = new DriverSettings({'deviceId':deviceId});
    return settings;
  }
}
