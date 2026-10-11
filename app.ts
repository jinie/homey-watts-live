'use strict';

import Homey from 'homey';
import BuiltinBroker, { BuiltinBrokerConfig } from './lib/BuiltinBroker';

class WattsLiveApp extends Homey.App {
  private applicationVersion: string | undefined;
  private debug: boolean = false;
  private applicationName: string = this.homey.manifest.name.en;
  public builtinBroker!: BuiltinBroker;
  private brokerRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private builtinBrokerConfigKey: string = '';

  async onInit() {
    try {
      this.applicationVersion = Homey.manifest.version;
      this.debug = process.env.DEBUG === '1';
      this.applicationName = Homey.manifest.name.en;
    } catch (error) {
      this.applicationVersion = undefined;
      this.debug = false;
      this.applicationName = this.constructor.name;
    }
    process.on('unhandledRejection', (reason, p) => {
      this.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
    });

    // Built-in MQTT broker, configured on the app settings page
    this.builtinBroker = new BuiltinBroker(this.log.bind(this), this.error.bind(this));
    this.homey.settings.on('set', (key: string) => {
      if (!key.startsWith('builtin_broker_')) {
        return;
      }
      // The settings page saves four keys one after another; restart once, when all are saved
      if (this.brokerRestartTimer) {
        this.homey.clearTimeout(this.brokerRestartTimer);
      }
      this.brokerRestartTimer = this.homey.setTimeout(() => {
        this.brokerRestartTimer = null;
        this.startBuiltinBroker(false).catch((error) => this.error(error));
      }, 3000);
    });
    await this.startBuiltinBroker(true);
  }

  /** (Re)start the built-in broker; unless forced, only when its settings changed. */
  private async startBuiltinBroker(force: boolean): Promise<void> {
    const config = this.getBuiltinBrokerConfig();
    const key = JSON.stringify(config);
    if (!force && key === this.builtinBrokerConfigKey) {
      return;
    }
    this.builtinBrokerConfigKey = key;
    await this.builtinBroker.start(config);
  }

  async onUninit() {
    await this.builtinBroker?.stop();
  }

  getBuiltinBrokerConfig(): BuiltinBrokerConfig {
    const port = Number(this.homey.settings.get('builtin_broker_port'));
    const text = (key: string) => {
      const value = this.homey.settings.get(key);
      return typeof value === 'string' ? value : '';
    };
    return {
      enabled: this.homey.settings.get('builtin_broker_enabled') === true,
      port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 1883,
      username: text('builtin_broker_username').trim(),
      password: text('builtin_broker_password'),
    };
  }

  /** Turn the built-in broker on (used when it is chosen during pairing) and wait for it to start. */
  async enableBuiltinBroker(): Promise<void> {
    if (this.homey.settings.get('builtin_broker_enabled') !== true) {
      this.homey.settings.set('builtin_broker_enabled', true);
    }
    // Start directly instead of waiting for the debounced settings listener
    await this.startBuiltinBroker(false);
  }

  /** Status for the settings page and the pairing screen. */
  async getBuiltinBrokerStatus() {
    let homeyAddress: string | null = null;
    try {
      homeyAddress = (await this.homey.cloud.getLocalAddress()).split(':')[0];
    } catch (error) {
      this.error('Could not read the Homey IP address', error);
    }
    const status = this.builtinBroker.status();
    return {
      ...status,
      error: status.error ? this.homey.__(status.error.key, status.error.vars) : null,
      homeyAddress,
    };
  }
}

module.exports = WattsLiveApp;
