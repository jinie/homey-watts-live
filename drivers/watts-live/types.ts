
export const Capabilities: string[] = [
    "meter_power.imported",
    "meter_power.exported",
    "measure_power",
    "measure_power.l1",
    "measure_power.l2",
    "measure_power.l3",
    "measure_current.l1",
    "measure_current.l2",
    "measure_current.l3",
    "measure_voltage.l1",
    "measure_voltage.l2",
    "measure_voltage.l3",
    'measure_power.negative_active',
    'measure_power.negative_l1',
    'measure_power.negative_l2',
    'measure_power.negative_l3',
    'measure_negative_reactive_energy',
    'measure_power.negative_reactive',
    'measure_positive_reactive_energy',
    'measure_power.positive_reactive'
  ];
/**
 * MeterReading interface to map MQTT message to JSON object
 */
export interface MeterReading {
    positive_active_power: number | undefined;
    positive_active_energy: number| undefined;
    positive_active_power_l1: number| undefined;
    positive_active_power_l2: number| undefined;
    positive_active_power_l3: number| undefined;
    current_l1: number| undefined;
    current_l2: number| undefined;
    current_l3: number| undefined;
    voltage_l1: number| undefined;
    voltage_l2: number| undefined;
    voltage_l3: number| undefined;
    negative_active_power: number| undefined;
    negative_active_energy: number| undefined;
    negative_reactive_power: number| undefined;
    negative_reactive_energy: number| undefined;
    positive_reactive_power: number| undefined;
    positive_reactive_energy: number| undefined;
    negative_active_power_l1: number| undefined;
    negative_active_power_l2: number| undefined;
    negative_active_power_l3: number| undefined;
};

export const ReadingToCapabilityMap: KvMap = { 
    "positive_active_energy": "meter_power.imported", 
    "positive_active_power": "measure_power", 
    "positive_active_power_l1": "measure_power.l1", 
    "positive_active_power_l2": "measure_power.l2", 
    "positive_active_power_l3": "measure_power.l3", 
    "current_l1": "measure_current.l1", 
    "current_l2": "measure_current.l2", 
    "current_l3": "measure_current.l3", 
    "voltage_l1": "measure_voltage.l1", 
    "voltage_l2": "measure_voltage.l2", 
    "voltage_l3": "measure_voltage.l3", 
    "negative_active_energy": "meter_power.exported", 
    "negative_active_power": "measure_power.negative_active", 
    "negative_active_power_l1": "measure_power.negative_l1", 
    "negative_active_power_l2": "measure_power.negative_l2", 
    "negative_active_power_l3": "measure_power.negative_l3", 
    "negative_reactive_energy": "measure_negative_reactive_energy", 
    "negative_reactive_power": "measure_power.negative_reactive", 
    "positive_reactive_energy": "measure_positive_reactive_energy", 
    "positive_reactive_power": "measure_power.positive_reactive" 
};

/**
 * Key-Value map interface for string:number
 */
export interface KvMap {
    [key: string]: any;
}

export interface MessagesCollected {
    [topic: string]: {
        messages: string[];
    };
}