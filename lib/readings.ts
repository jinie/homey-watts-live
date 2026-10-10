'use strict';

import KvMap from '../types/KvMap';
import { ReadingToCapabilityMap } from './constants';

// Watts Live reports energy in Wh; Homey meter_power is kWh.
const ENERGY_CAPABILITIES: string[] = [
  'meter_power.imported',
  'meter_power.exported',
  'meter_power.negative_reactive',
  'meter_power.positive_reactive',
];

// Field name without the positive_/negative_ prefix -> net capability
export const NetPowerCapabilityMap: KvMap = {
  active_power: 'measure_power.net',
  active_power_l1: 'measure_power.net_l1',
  active_power_l2: 'measure_power.net_l2',
  active_power_l3: 'measure_power.net_l3',
  reactive_power: 'measure_power.reactive',
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Parse a raw Watts Live payload (Buffer, JSON string or object).
 * Returns null when the payload is not a JSON object.
 */
export function parsePayload(message: unknown): Record<string, unknown> | null {
  let parsed: unknown = message;
  if (Buffer.isBuffer(message)) {
    parsed = JSON.parse(message.toString());
  } else if (typeof message === 'string') {
    parsed = JSON.parse(message);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/**
 * Map a Watts Live reading to capability values.
 * Fields that are missing or not a finite number are left out, so a meter
 * that does not report e.g. per-phase power never overwrites those values with 0.
 */
export function readingToCapabilities(reading: Record<string, unknown>): KvMap {
  const values: KvMap = {};
  Object.keys(ReadingToCapabilityMap).forEach((field) => {
    const capability = ReadingToCapabilityMap[field];
    const value = reading[field];
    if (!isFiniteNumber(value)) {
      return;
    }
    values[capability] = ENERGY_CAPABILITIES.includes(capability) ? value / 1000 : value;
  });

  // Net power: import minus export (negative while exporting, e.g. solar)
  Object.keys(NetPowerCapabilityMap).forEach((field) => {
    const imported = reading[`positive_${field}`];
    const exported = reading[`negative_${field}`];
    if (!isFiniteNumber(imported) && !isFiniteNumber(exported)) {
      return;
    }
    values[NetPowerCapabilityMap[field]] = (isFiniteNumber(imported) ? imported : 0)
      - (isFiniteNumber(exported) ? exported : 0);
  });

  // Power factor (cos φ) = |P| / √(P² + Q²); undefined when there is no active or reactive power
  const p = values['measure_power.net'];
  const q = values['measure_power.reactive'];
  if (isFiniteNumber(p) && isFiniteNumber(q) && (p !== 0 || q !== 0)) {
    values.measure_power_factor = Math.round((Math.abs(p) / Math.hypot(p, q)) * 1000) / 1000;
  }
  return values;
}
