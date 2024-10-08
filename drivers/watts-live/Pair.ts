import Homey from 'homey';
import { PairSession } from 'homey/lib/Driver';
import { MqttService } from '../../lib/MqttService';
import { DriverSettings } from './DriverSettings';

class PairingFlow {
  private settings:DriverSettings;

  constructor() {
    this.settings = {
        deviceId: "",
        clientId: "",
        useMqttClient: true,
        hostname: 'localhost',
        port: 1883,
        useTls: false,
        username: '',
        password: '',
        caCertificate: '',
        clientCertificate: '',
        clientKey: '',
        rejectUnauthorized: true
    };
  }

  async onPair(session: PairSession) {
    session.setHandler('start_pair', async () => {
      session.showView('select_mqtt_method');
    });

    session.setHandler('select_mqtt_method', async (data: any) => {
      this.settings.useMqttClient = data.mqttClientOption;
      
      if (this.settings.username === 'custom') {
        session.showView('mqtt_custom_config');
      } else {
        await this.finalizePairing(session);
      }
    });

    session.setHandler('mqtt_custom_config', async (data: any) => {
      this.settings.hostname = data.mqttHost || 'localhost';
      this.settings.port = data.mqttPort || 1883;
      this.settings.useTls = data.mqttUseTLS || false;
      this.settings.username = data.mqttUsername;
      this.settings.password = data.mqttPassword;

      await this.finalizePairing(session);
    });
  }

  private async finalizePairing(session: PairSession) {
    try {
     /* const mqttService = new MqttService();
      await mqttService.connectToMqtt(this.settings);
      
      // Simulate device discovery via MQTT
      const discoveredDevice = await mqttService.discoverDevice();
      if (!discoveredDevice) throw new Error('Device discovery failed.');

      session.emit("DeviceFound",{
        name: discoveredDevice.name,
        data: {
          id: discoveredDevice.id,
          mqttSettings: this.settings
        },
      });*/
    } catch (error) {
        session.emit("error", {error});
      session.showView('error');
      console.error('Pairing failed', error);
    }
  }
}

module.exports = PairingFlow;
