'use strict';

export default class DriverSettings {

  public deviceId: string = '';
  public hostname: string = 'localhost';
  public port: number = 1883;
  public clientId: string = 'homey-watts-live';
  public username: string = '';
  public password: string = '';
  public useTls: boolean = false;
  public useHomeyMqttClient: string = 'homey';
  public acceptSelfSignedCert: boolean = false; // New setting for self-signed certificates

  constructor(settings?: Partial<DriverSettings>) {
    if (settings) {
      Object.assign(this, settings);
    }
  }

  private static normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  validate(options?: { requireDeviceId?: boolean }): string[] {
    const errors: string[] = [];
    const requireDeviceId = options?.requireDeviceId === true;

    if (requireDeviceId && DriverSettings.normalizeString(this.deviceId).length === 0) {
      errors.push('Device ID is required');
    }

    if (this.useHomeyMqttClient !== 'custom') {
      return errors;
    }

    const hostname = DriverSettings.normalizeString(this.hostname);
    const clientId = DriverSettings.normalizeString(this.clientId);
    const username = DriverSettings.normalizeString(this.username);
    const password = DriverSettings.normalizeString(this.password);

    if (hostname.length === 0) {
      errors.push('Hostname is required');
    } else {
      if (hostname.includes('://')) {
        errors.push('Hostname must not include a protocol such as mqtt:// or mqtts://');
      }
      if (/\s/.test(hostname)) {
        errors.push('Hostname must not contain spaces');
      }
      if (hostname.includes('/')) {
        errors.push('Hostname must not contain path separators');
      }
    }

    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) {
      errors.push('Port must be a whole number between 1 and 65535');
    }

    if (clientId.length === 0) {
      errors.push('Client ID is required');
    }

    if (username.includes('\n') || username.includes('\r')) {
      errors.push('Username must be a single line');
    }

    if (password.includes('\n') || password.includes('\r')) {
      errors.push('Password must be a single line');
    }

    return errors;
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

  static driverSettingsDefault(deviceId: string): DriverSettings {
    const settings = new DriverSettings({ deviceId });
    return settings;
  }
}
