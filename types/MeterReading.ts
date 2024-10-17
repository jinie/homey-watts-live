/**
* MeterReading interface to map MQTT message to JSON object
*/
export class MeterReading {
  positive_active_power: number = 0;
  positive_active_energy: number = 0;
  positive_active_power_l1: number = 0;
  positive_active_power_l2: number = 0;
  positive_active_power_l3: number = 0;
  current_l1: number = 0;
  current_l2: number = 0;
  current_l3: number = 0;
  voltage_l1: number = 0;
  voltage_l2: number = 0;
  voltage_l3: number = 0;
  negative_active_power: number = 0;
  negative_active_energy: number = 0;
  negative_reactive_power: number = 0;
  negative_reactive_energy: number = 0;
  positive_reactive_power: number = 0;
  positive_reactive_energy: number = 0;
  negative_active_power_l1: number = 0;
  negative_active_power_l2: number = 0;
  negative_active_power_l3: number = 0;
  
  constructor(settings?: Partial<MeterReading>) {
    if (settings) {
      Object.assign(this, settings);
    }
  }
};