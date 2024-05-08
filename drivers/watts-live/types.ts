/**
 * MeterReading interface to map MQTT message to JSON object
 */
export interface MeterReading {
    positive_active_power: number;
    positive_active_energy: number;
    positive_active_power_l1: number;
    positive_active_power_l2: number;
    positive_active_power_l3: number;
    current_l1: number;
    current_l2: number;
    current_l3: number;
    voltage_l1: number;
    voltage_l2: number;
    voltage_l3: number;
    negative_active_power: number;
    negative_active_energy: number;
    negative_reactive_power: number;
    negative_reactive_energy: number;
    positive_reactive_power: number;
    positive_reactive_energy: number;
    negative_active_power_l1: number;
    negative_active_power_l2: number;
    negative_active_power_l3: number;
};

/**
 * Key-Value map interface for string:number
 */
export interface KvMap {
    [key: string]: number;
}

export interface MessagesCollected {
    [topic: string]: {
        messages: string[];
    };
}