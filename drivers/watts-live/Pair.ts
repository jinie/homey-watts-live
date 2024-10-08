import Homey from 'homey';
import { MqttService } from '../../lib/MqttService';
import { DriverSettings } from '../../lib/types';

class PairingFlow extends Homey.Flow {
    private settings: DriverSettings;
    private mqttService: MqttService;
    private discoveredDevices: any[];

    constructor(driver: any) {
        super(driver);
        this.settings = {
            deviceId: '',
            useMqttClient: false,
            hostname: 'localhost',
            port: 1883,
            clientId: 'homey_' + Math.random().toString(16).substr(2, 8), // Generating a random clientId
            username: '',
            password: '',
            useTls: false,
            caCertificate: '',
            clientCertificate: '',
            clientKey: '',
            rejectUnauthorized: true,
        };
        this.mqttService = new MqttService(this.homey.app);
        this.discoveredDevices = [];
    }

    async onPair(session) {
        session.showView('start');

        session.on('view:start', (data, callback) => {
            callback(null, {
                title: 'Select MQTT Method',
                options: [
                    { id: 'scanno', name: "Use Homey's MQTT Client (nl.scanno.mqtt)" },
                    { id: 'custom', name: 'Use a custom MQTT server' }
                ]
            });
        });

        session.on('view:select_mqtt_method', (data, callback) => {
            this.settings.useMqttClient = data.mqttClientOption === 'scanno';

            if (this.settings.useMqttClient) {
                // Use the Homey MQTT Client
                this.connectAndDiscoverDevices(session);
            } else {
                session.showView('mqtt_custom_config');
            }
        });

        session.on('view:mqtt_custom_config', (data, callback) => {
            // Update settings from the form inputs
            this.settings.hostname = data.mqttHost || 'localhost';
            this.settings.port = data.mqttPort || 1883;
            this.settings.username = data.mqttUsername || '';
            this.settings.password = data.mqttPassword || '';
            this.settings.useTls = data.mqttUseTLS || false;
            this.settings.caCertificate = data.caCertificate || '';
            this.settings.clientCertificate = data.clientCertificate || '';
            this.settings.clientKey = data.clientKey || '';
            this.settings.rejectUnauthorized = data.rejectUnauthorized || true;

            this.connectAndDiscoverDevices(session);
        });

        session.on('list_devices', (data, callback) => {
            callback(null, this.discoveredDevices);
        });
    }

    private async connectAndDiscoverDevices(session) {
        try {
            await this.mqttService.connectToMqtt(this.settings);

            this.mqttService.listenForDevices('/watts/+/measurement', (device) => {
                if (!this.discoveredDevices.some(d => d.id === device.id)) {
                    this.discoveredDevices.push(device);
                }
                session.emit('list_devices', this.discoveredDevices);
            });

            session.showView('waiting_for_devices');
        } catch (error) {
            console.error('Error during device discovery:', error);
            session.showView('error', { error: error.message });
        }
    }
}

export default PairingFlow;
