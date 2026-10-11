'use strict';

import Homey from 'homey';
import { EventEmitter } from 'events';
import IMqttConnector from '../types/IMqttConnector';
import DiscoveredDevice from '../types/DiscoveredDevice';
import BuiltinBroker from './BuiltinBroker';
import delay from './delay';
import { parseWattsTopic } from './topics';

// Meters that published this recently are offered during pairing even if they stay silent while discovering
const RECENTLY_SEEN_MS = 5 * 60 * 1000;

/**
 * True when an MQTT topic filter (with + and # wildcards) matches the topic.
 * A leading slash is ignored, as some Watts Live firmware publishes to /watts/...
 */
export function topicMatches(filter: string, topic: string): boolean {
  const filterLevels = filter.replace(/^\//, '').split('/');
  const topicLevels = topic.replace(/^\//, '').split('/');
  for (let i = 0; i < filterLevels.length; i++) {
    if (filterLevels[i] === '#') {
      return true;
    }
    if (i >= topicLevels.length) {
      return false;
    }
    if (filterLevels[i] !== '+' && filterLevels[i] !== topicLevels[i]) {
      return false;
    }
  }
  return filterLevels.length === topicLevels.length;
}

/**
 * Connector for the MQTT broker built into this app. Instead of a network
 * connection it listens to the publishes the broker receives.
 */
export default class BuiltinMqttConnector extends EventEmitter implements IMqttConnector {
  private readonly broker: BuiltinBroker;
  private topics: string[] = [];
  private isConnected: boolean = false;

  private readonly onBrokerMessage = (topic: string, payload: Buffer) => {
    if (this.topics.some((filter) => topicMatches(filter, topic))) {
      this.emit('message', topic, payload);
    }
  };

  // The broker was stopped or restarted (settings changed); devices reconnect
  private readonly onBrokerRestart = () => {
    if (this.isConnected) {
      this.detach();
      this.emit('disconnect');
    }
  };

  constructor(homey: Homey.App['homey']) {
    super();
    this.broker = (homey.app as unknown as { builtinBroker: BuiltinBroker }).builtinBroker;
  }

  private detach(): void {
    this.broker.off('message', this.onBrokerMessage);
    this.broker.off('restart', this.onBrokerRestart);
    this.isConnected = false;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }
    const status = this.broker.status();
    if (!status.enabled) {
      throw new Error('The built-in MQTT broker is turned off in the app settings');
    }
    if (!status.running) {
      throw new Error(`The built-in MQTT broker is not running on port ${status.port}`);
    }
    this.broker.on('message', this.onBrokerMessage);
    this.broker.on('restart', this.onBrokerRestart);
    this.isConnected = true;
    this.emit('connect');
  }

  async disconnect(): Promise<void> {
    this.detach();
    this.topics = [];
  }

  async subscribe(topic: string): Promise<void> {
    if (!this.topics.includes(topic)) {
      this.topics.push(topic);
    }
  }

  async unsubscribe(topic: string): Promise<void> {
    this.topics = this.topics.filter((t) => t !== topic);
  }

  publish(): void {
    // Nothing to publish to Watts Live
  }

  async discoverDevices(topic: string, timeout: number = 10000): Promise<DiscoveredDevice[]> {
    // Start with meters seen recently, but always listen for the full window:
    // the recently seen ones may all be paired already while a new meter is about to publish
    const ids = new Set<string>(this.broker.recentlySeen(RECENTLY_SEEN_MS));
    const onDiscoveryMessage = (receivedTopic: string) => {
      const serial = parseWattsTopic(receivedTopic);
      if (serial) {
        ids.add(serial);
      }
    };
    await this.subscribe(topic);
    this.on('message', onDiscoveryMessage);
    try {
      await delay(timeout, undefined);
    } finally {
      this.off('message', onDiscoveryMessage);
      await this.unsubscribe(topic);
    }
    return [...ids].map((id) => ({
      id,
      name: `Watts Live - ${id}`,
      data: { id },
      settings: { deviceId: id },
    }));
  }
}
