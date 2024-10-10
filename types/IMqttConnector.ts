export interface IMqttConnector {
    connect(): Promise<void>;
    disconnect(): void;
    subscribe(topic: string, messageHandler: (topic: string, message: Buffer | string) => void): void;
    unsubscribe(topic: string): void;
    publish(topic: string, message: string): void;
  }