'use strict';

// Watts Live publishes to watts/<serial>/measurement; some firmware adds a leading slash
const WATTS_TOPIC = /^\/?watts\/([^/]+)\/measurement$/;

/** Returns the meter serial number for a Watts Live measurement topic, otherwise null. */
export function parseWattsTopic(topic: string): string | null {
  const match = WATTS_TOPIC.exec(topic);
  return match ? match[1] : null;
}

/** The topic a meter publishes its measurements to. */
export function measurementTopic(deviceId: string): string {
  return `watts/${deviceId}/measurement`;
}
