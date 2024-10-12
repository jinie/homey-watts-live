import { KvMap } from "../types/KvMap";

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
    'meter_power.negative_reactive',
    'measure_power.negative_reactive',
    'meter_power.positive_reactive',
    'measure_power.positive_reactive'
];


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
    "negative_reactive_energy": "meter_power.negative_reactive", 
    "negative_reactive_power": "measure_power.negative_reactive", 
    "positive_reactive_energy": "meter_power.positive_reactive", 
    "positive_reactive_power": "measure_power.positive_reactive" 
};


export const addedCapabilitiesV1toV2:string[] = [
    'meter_power.exported',
    'measure_power.negative_active',
    'measure_power.l1',
    'measure_power.l2',
    'measure_power.l3',
    'measure_voltage.l1',
    'measure_voltage.l2',
    'measure_voltage.l3',
    'measure_current.l1',
    'measure_current.l2',
    'measure_current.l3',
    'measure_power.negative_l1',
    'measure_power.negative_l2',
    'measure_power.negative_l3',
    'meter_power.negative_reactive',
    'measure_power.negative_reactive',
    'meter_power.positive_reactive',
    'measure_power.positive_reactive'
]

export const removedCapabilitiesV1toV2: string[] = [
    'measure_power_l1',
    'measure_power_l2',
    'measure_power_l3',
    'measure_voltage_l1',
    'measure_voltage_l2',
    'measure_voltage_l3',
    'measure_current_l1',
    'measure_current_l2',
    'measure_current_l3',
    'measure_negative_active_power',
    'measure_negative_power_l1',
    'measure_negative_power_l2',
    'measure_negative_power_l3',
    'measure_positive_reactive_energy',
    'measure_negative_reactive_energy'
];






