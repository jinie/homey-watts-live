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


/**
 * {
  "positive_active_energy": 1198712,
  "negative_active_energy": 0,
  "positive_reactive_energy": 0,
  "negative_reactive_energy": 0,
  "positive_active_power": 3104,
  "negative_active_power": 0,
  "positive_reactive_power": 0,
  "negative_reactive_power": 0,
  "voltage_l1": 380,
  "voltage_l2": 380,
  "voltage_l3": 380,
  "current_l1": 1.1,
  "current_l2": 1.65,
  "current_l3": 5.42,
  "positive_active_power_l1": 418,
  "positive_active_power_l2": 627,
  "positive_active_power_l3": 2059,
  "negative_active_power_l1": 0,
  "negative_active_power_l2": 0,
  "negative_active_power_l3": 0
}
 */
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
    "negative_active_power": "measure_negative_power", 
    "negative_active_power_l1": "measure_negative_power.l1", 
    "negative_active_power_l2": "measure_negative_power.l2", 
    "negative_active_power_l3": "measure_negative_power.l3", 
    "negative_reactive_energy": "measure_negative_reactive_energy", 
    "negative_reactive_power": "measure_negative_reactive_power", 
    "positive_reactive_energy": "measure_positive_reactive_energy", 
    "positive_reactive_power": "measure_positive_reactive_power" 
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