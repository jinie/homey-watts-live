'use strict';

import { EventEmitter } from 'events';
import net from 'net';
import { parseWattsTopic } from './topics';

export interface BuiltinBrokerConfig {
  enabled: boolean;
  port: number;
  username: string;
  password: string;
}

export interface BuiltinBrokerError {
  key: string; // locale key, translated by the app
  vars: Record<string, string | number>;
}

export interface BuiltinBrokerStatus {
  enabled: boolean;
  running: boolean;
  port: number;
  auth: boolean;
  clients: number;
  messages: number;
  lastMessageAt: string | null;
  error: BuiltinBrokerError | null;
  seen: string[]; // meter serial numbers that have published since start
}

const RETRY_MS = 60 * 1000;

// Minimal shape of the aedes broker that is used here (aedes is ESM-only and loaded dynamically)
interface AedesLike extends EventEmitter {
  handle: (socket: net.Socket) => void;
  authenticate?: (
    client: { id?: string } | null,
    username: string | undefined,
    password: Buffer | undefined,
    done: (error: null, success: boolean) => void,
  ) => void;
  connectedClients: number;
  close: (cb?: () => void) => void;
}

/**
 * MQTT broker built into the app, so Watts Live can publish directly to Homey
 * without an external broker or the MQTT Client/Broker apps.
 * Emits 'message' (topic, payload) for every publish from a connected client
 * and 'restart' whenever it is stopped or restarted.
 * start() and stop() are queued, so two restarts never overlap.
 */
export default class BuiltinBroker extends EventEmitter {
  private config: BuiltinBrokerConfig | null = null;
  private aedes: AedesLike | null = null;
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly seen = new Map<string, number>();
  private state = {
    running: false,
    clients: 0,
    messages: 0,
    lastMessageAt: null as string | null,
    error: null as BuiltinBrokerError | null,
  };

  constructor(
    private readonly log: (...args: unknown[]) => void,
    private readonly logError: (...args: unknown[]) => void,
  ) {
    super();
    this.setMaxListeners(50);
  }

  /** (Re)start with the given configuration. Never throws; errors end up in status().error. */
  start(config: BuiltinBrokerConfig): Promise<void> {
    return this.enqueue(async () => {
      await this.stopNow();
      this.config = config;
      this.state.error = null;
      if (config.enabled) {
        await this.startNow();
      }
      this.emit('restart');
    });
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.stopNow());
  }

  status(): BuiltinBrokerStatus {
    return {
      enabled: this.config?.enabled === true,
      running: this.state.running,
      port: this.config?.port ?? 1883,
      auth: !!(this.config?.username || this.config?.password),
      clients: this.state.clients,
      messages: this.state.messages,
      lastMessageAt: this.state.lastMessageAt,
      error: this.state.error,
      seen: [...this.seen.keys()],
    };
  }

  /** Serial numbers that published within the given time window. */
  recentlySeen(withinMs: number): string[] {
    const since = Date.now() - withinMs;
    return [...this.seen.entries()].filter(([, at]) => at >= since).map(([serial]) => serial);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task).catch((error) => this.logError('Built-in broker:', error));
    return this.queue;
  }

  private scheduleRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    const { config } = this;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (config) {
        this.start(config).catch(() => {});
      }
    }, RETRY_MS);
  }

  private onPublish(topic: string, payload: Buffer): void {
    const serial = parseWattsTopic(topic);
    if (serial) {
      this.seen.set(serial, Date.now());
      this.state.messages += 1;
      this.state.lastMessageAt = new Date().toISOString();
    }
    this.emit('message', topic, payload);
  }

  private async startNow(): Promise<void> {
    const config = this.config!;
    let aedes: AedesLike;
    try {
      const { Aedes } = await import('aedes');
      aedes = await Aedes.createBroker() as unknown as AedesLike;
    } catch (error) {
      this.state.error = { key: 'builtin_broker.errors.start', vars: { message: (error as Error).message } };
      this.logError('Built-in broker cannot start:', error);
      return;
    }
    this.aedes = aedes;

    // A password alone also requires login, so the broker is never open by mistake
    const loginRequired = !!(config.username || config.password);
    if (loginRequired) {
      aedes.authenticate = (client, username, password, done) => {
        const ok = username === config.username
          && (password ? password.toString() : '') === config.password;
        if (!ok) {
          this.logError(`Built-in broker rejected login from ${client?.id ?? 'unknown client'}`);
        }
        done(null, ok);
      };
    }
    aedes.on('publish', (packet: { topic: string; payload: Buffer }, client: unknown) => {
      // client is null for the broker's own $SYS messages
      if (client && this.aedes === aedes) {
        this.onPublish(packet.topic, packet.payload);
      }
    });
    const countClients = () => {
      if (this.aedes === aedes) {
        this.state.clients = aedes.connectedClients;
      }
    };
    aedes.on('client', countClients);
    aedes.on('clientDisconnect', countClients);

    const server = net.createServer((socket) => aedes.handle(socket));
    this.server = server;
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });

    await new Promise<void>((resolve) => {
      server.once('listening', () => {
        this.state.running = true;
        this.log(`Built-in MQTT broker listening on port ${config.port}${loginRequired ? ' (login required)' : ''}`);
        resolve();
      });
      server.on('error', (error: NodeJS.ErrnoException) => {
        if (this.server !== server) {
          return;
        }
        this.state.running = false;
        this.state.error = {
          key: 'builtin_broker.errors.listen',
          vars: { port: config.port, code: error.code || error.message },
        };
        this.logError(`Built-in broker cannot listen on port ${config.port}: ${error.code || error.message}`);
        this.scheduleRetry();
        resolve();
      });
      server.listen(config.port);
    });
  }

  private async stopNow(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const tasks: Promise<void>[] = [];
    if (this.server) {
      const { server } = this;
      this.server = null;
      tasks.push(new Promise((resolve) => {
        server.close(() => resolve());
      }));
    }
    if (this.aedes) {
      const { aedes } = this;
      this.aedes = null;
      tasks.push(new Promise((resolve) => {
        aedes.close(() => resolve());
      }));
    }
    // server.close() waits for every socket, including half-open ones that never sent CONNECT
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    await Promise.all(tasks);
    this.state.running = false;
    this.state.clients = 0;
  }
}
