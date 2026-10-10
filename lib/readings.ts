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
  return values;
}
