'use strict';

import { EventEmitter } from 'events'; // Import EventEmitter

export default interface IMqttConnector extends EventEmitter {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    subscribe(topic: string): Promise<void>;
    unsubscribe(topic: string): Promise<void>;
    publish(topic: string, message: string): void;
    discoverDevices(topic: string, timeout: number): Promise<any[]>;
}
