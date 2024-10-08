export interface DriverSettings {
    deviceId: string;
    useMqttClient: boolean;
    hostname: string;
    port: number;
    clientId: string;
    username: string;
    password: string;
    useTls: boolean;
    caCertificate: string;
    clientCertificate: string;
    clientKey: string;
    rejectUnauthorized: boolean;
};

