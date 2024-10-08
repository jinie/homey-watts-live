import { connect, MqttClient } from 'mqtt';
import Homey, {ApiApp} from 'homey';
import { DriverSettings } from './types';
import { EventEmitter } from 'stream';
import mqtt from 'mqtt';

export class MqttService extends EventEmitter {
    private client: MqttClient | null = null;
    private homey: Homey.App["homey"];
    private MQTTClient: Homey.ApiApp;
    private clientAvailable: boolean = false;
    private mqttClientInitialized: boolean = false;
    private applicationName: string;
    private applicationVersion = Homey.manifest.version;
    lastMqttMessage: number | undefined = undefined;
    private topics: string[] = [];
    debug: any;
    updateInterval: number = 30000;
    nextRequest: number | undefined = Date.now() + this.updateInterval;   
    
    constructor(homey: Homey.App["homey"], debug=false){
        super();
        this.debug = debug;
        this.homey = homey;
        this.MQTTClient = this.homey.api.getApiApp('nl.scanno.mqtt') as ApiApp;
        this.applicationName = this.homey.manifest.name.en;
    }
    
    async connectToMqtt(config: DriverSettings) {
        //this.homey.log(config);
        if (config.useMqttClient === true) {
            this.homey.log("Using built-in MQTT Client");
            await this.connectViaScannoClient(config);
        } else {
            this.homey.log("Using custom MQTT client");
            await this.connectToNativeMqtt(config);
        }
    }
    
    private async connectViaScannoClient(settings:DriverSettings) {
        await this.connectMqttClient(settings);
        setInterval(() => {
            try {
                if ((this.lastMqttMessage !== undefined) && (Date.now() - this.lastMqttMessage > 10 * 60 * 1000)) {
                    this.homey.log(`MQTT connection timeout. Resetting connection`);
                    this.lastMqttMessage = -1;
                    this.connectMqttClient(settings);
                }
            } catch (error) {
                if (this.debug)
                    throw (error);
                else
                this.homey.log(`${this.constructor.name} checkDevices error: ${error}`);
            }
        }, 60000);
    }
   
    async disconnectFromMqtt(config: DriverSettings) {
        if (this.client) {
            this.client.end();
            this.client = null;
            this.emit("disconnect");
            console.log('MQTT connection closed');
        }
    }
    
    register(settings: DriverSettings) {
        try {
            // Subscribing to system topic to check if connection still alive (update ~10 second for mosquitto)
            this.lastMqttMessage = Date.now();
            let err = this.subscribeTopic(`watts/${settings?.deviceId}/measurement`);
            if (err) {
                this.homey.log(`Error subscribing to topic: watts/+/measurement, error: ${JSON.stringify(err)}`);
                return;
            }
            let now = Date.now();
            this.nextRequest = now;
        } catch (error) {
            if (this.debug)
                throw (error);
            else
            this.homey.log(`${this.constructor.name} register error: ${error}`);
        }
    }
    
    unregister() {
        this.clientAvailable = false;
        this.lastMqttMessage = -1;
        this.mqttClientInitialized = false;
        this.emit('unregister');
        this.homey.log(`${this.constructor.name} unregister called`);
    }
    
    subscribeTopic(topicName: string) {
        this.homey.log("Subscribing to topic: " + topicName);
        if (!this.clientAvailable){
            this.homey.log(`MQTT client not available, can not subscribe to topic: ${topicName}`);
            return;
        }
        return this.MQTTClient.post('subscribe', { topic: topicName }).then((error: any) => {
            if (error.result != 0) {
                this.homey.log(`Can not subscrive to topic ${topicName}, error: ${JSON.stringify(error)}`)
            } else {
                this.emit('subscribed',topicName);
                this.homey.log(`Sucessfully subscribed to topic: ${topicName}`);
            }
        });
    }
    
    sendMessage(topic: string, payload: string) {
        this.homey.log(`sendMessage: ${topic} <= ${payload}`);
        if (!this.clientAvailable)
            return;
        this.MQTTClient.post('send', {
            qos: 0,
            retain: false,
            mqttTopic: topic,
            mqttMessage: payload
        }).catch((error: any) => {
            if (error)
                this.homey.log(`Error sending ${topic} <= "${payload}"`);
        });
    }
    
    onMessage(topic: string, message: string) {
        try{
            this.lastMqttMessage = Date.now();
            if(this.debug){
                this.homey.log(`Message Received ${topic} - ${message}`);
            }
            this.emit('realtime',topic,message);
        }catch(error:any){
            this.homey.log(`Error calling callback function : ${error}`);
        }
    }
    
    setupMqttClient(settings: DriverSettings): boolean {
        if(!this.mqttClientInitialized){
            try{
                this.MQTTClient
                .on('install', () => this.register(settings))
                .on('uninstall', () => this.unregister())
                .on('realtime', (topic: string, message: string) => {
                    this.onMessage(topic, message);
                });
                this.mqttClientInitialized = true;
            } catch (error) {
                this.homey.log(`MQTT client setup error: ${error}`);
            }
        }
        return this.mqttClientInitialized;
    }
    
    configureMqttClient(settings: DriverSettings){
        //Setup MQTT client
        this.topics = ["watts"];
        this.lastMqttMessage = -1;
        this.clientAvailable = false;
        this.connectMqttClient(settings);
        this.homey.log(`${this.applicationName} is running. Version: ${this.applicationVersion}, debug: ${this.debug}`);
        setInterval(() => {
            try {
                if ((this.lastMqttMessage !== undefined) && (Date.now() - this.lastMqttMessage > 10 * 60 * 1000)) {
                    this.homey.log(`MQTT connection timeout. Resetting connection`);
                    this.lastMqttMessage = -1;
                    this.connectMqttClient(settings);
                }
            } catch (error) {
                if (this.debug)
                    throw (error);
                else
                this.homey.log(`${this.constructor.name} checkDevices error: ${error}`);
            }
        }, 60000);
    }
    
    connectMqttClient(settings: DriverSettings) {
        this.MQTTClient.getInstalled()
        .then((installed: boolean) => {
            this.clientAvailable = installed;
            this.homey.log(`MQTT client status: ${this.clientAvailable}`);
            if (installed) {
                if(this.setupMqttClient(settings) === false) 
                    return;
                this.register(settings);
                this.homey.apps.getVersion(this.MQTTClient).then((version) => {
                    this.homey.log(`MQTT client installed, version: ${version}`);
                });
            }
        }).catch((error: any) => {
            this.homey.log(`MQTT client app error: ${error}`);
        });
        
    }

    async connectToNativeMqtt(config: DriverSettings): Promise<void> {
        const options: mqtt.IClientOptions = {
            clientId: config.clientId,
            username: config.username || undefined,
            password: config.password || undefined,
            rejectUnauthorized: config.rejectUnauthorized,
        };

        if (config.useTls) {
            options.protocol = 'mqtts';
            options.ca = config.caCertificate ? [config.caCertificate] : undefined;
            options.cert = config.clientCertificate || undefined;
            options.key = config.clientKey || undefined;
        } else {
            options.protocol = 'mqtt';
        }

        this.client = mqtt.connect(`mqtt://${config.hostname}:${config.port}`, options);

        return new Promise((resolve, reject) => {
            this.client?.on('connect', () => {
                console.log('Connected to MQTT broker');
                resolve();
            });

            this.client?.on('error', (error) => {
                console.error('Failed to connect to MQTT broker', error);
                reject(error);
            });
        });
    }

    listenForDevices(settings: DriverSettings, topic: string, onDeviceDiscovered: (device: any) => void): void {
        if(settings.useMqttClient){
            this.listenForDevicesBuiltIn(settings, topic, onDeviceDiscovered);
        }else{
            this.listenForDevicesNative(settings, topic, onDeviceDiscovered);
        }
    }

    async listenForDevicesBuiltIn(settings: DriverSettings, topic: string, onDeviceDiscovered: (device: any)=> void): Promise<void> {
        if(!this.clientAvailable) throw new Error('MQTT client not connected');
        await this.subscribeTopic(topic);
        this.MQTTClient.on('realtime',(topic,message) => {
            const match = topic.match(/\/watts\/(.+)\/measurement/);
            if (match) {
                const deviceId = match[1];
                const deviceName = `Device ${deviceId}`;
                onDeviceDiscovered({ id: deviceId, name: deviceName });
            }
        })
    }

    async listenForDevicesNative(settings: DriverSettings, topic: string, onDeviceDiscovered: (device: any) => void): Promise<void> {
        if (!this.client) throw new Error('MQTT client not connected.');

        this.client.subscribe(topic, (err) => {
            if (err) {
                throw new Error(`Failed to subscribe to topic: ${topic}`);
            }
        });

        this.client.on('message', (topic, message) => {
            const match = topic.match(/\/watts\/(.+)\/measurement/);
            if (match) {
                const deviceId = match[1];
                const deviceName = `Device ${deviceId}`;
                onDeviceDiscovered({ id: deviceId, name: deviceName });
            }
        });
    }

    disconnect(): void {
        if (this.client) {
            this.client.end();
            console.log('MQTT connection closed');
        }
    }
}