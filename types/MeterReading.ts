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