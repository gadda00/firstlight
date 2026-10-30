/* ==========================================================================
 * FirstLight - Real-time Streaming System
 * 
 * Provides WebSocket and Server-Sent Events (SSE) for live data updates.
 * Supports:
 * - Real-time data ingestion from adapters
 * - Live map updates
 * - Event notifications
 * - Multi-client broadcast
 * - Connection management
 * 
 * Integrates with the adapter framework for streaming data sources.
 * ========================================================================== */

import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import type { Server } from 'http';
import type { DataSourceAdapter, DiscoveredAsset, NormalizedProduct } from '../adapters/types';
import { ADAPTERS, adapterById } from '../adapters/registry';

// ==========================================================================
// Types
// ==========================================================================

/** Streaming message types */
export type StreamingMessageType = 
  | 'data:new'
  | 'data:update'
  | 'data:remove'
  | 'map:layer:add'
  | 'map:layer:update'
  | 'map:layer:remove'
  | 'event:notification'
  | 'adapter:health'
  | 'system:status'
  | 'error'
  | 'ping'
  | 'pong';

/** Base streaming message */
export interface StreamingMessage<T extends StreamingMessageType, P = unknown> {
  type: T;
  timestamp: number;
  payload: P;
  source?: string;
  requestId?: string;
}

/** Data new message */
export interface DataNewMessage extends StreamingMessage<'data:new', {
  adapterId: string;
  asset: DiscoveredAsset | NormalizedProduct;
  layerId?: string;
}> {}

/** Data update message */
export interface DataUpdateMessage extends StreamingMessage<'data:update', {
  adapterId: string;
  assetId: string;
  changes: Partial<DiscoveredAsset | NormalizedProduct>;
  layerId?: string;
}> {}

/** Data remove message */
export interface DataRemoveMessage extends StreamingMessage<'data:remove', {
  adapterId: string;
  assetId: string;
  layerId?: string;
}> {}

/** Map layer add message */
export interface MapLayerAddMessage extends StreamingMessage<'map:layer:add', {
  layerId: string;
  layerType: string;
  adapterId?: string;
  config: any;
}> {}

/** Map layer update message */
export interface MapLayerUpdateMessage extends StreamingMessage<'map:layer:update', {
  layerId: string;
  changes: any;
}> {}

/** Map layer remove message */
export interface MapLayerRemoveMessage extends StreamingMessage<'map:layer:remove', {
  layerId: string;
}> {}

/** Event notification message */
export interface EventNotificationMessage extends StreamingMessage<'event:notification', {
  eventType: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  data?: any;
}> {}

/** Adapter health message */
export interface AdapterHealthMessage extends StreamingMessage<'adapter:health', {
  adapterId: string;
  health: 'live' | 'degraded' | 'blocked' | 'error';
  healthNote: string;
  timestamp: number;
}> {}

/** System status message */
export interface SystemStatusMessage extends StreamingMessage<'system:status', {
  status: 'operational' | 'degraded' | 'maintenance' | 'error';
  components: Record<string, {
    status: string;
    message?: string;
  }>;
  timestamp: number;
}> {}

/** Error message */
export interface ErrorMessage extends StreamingMessage<'error', {
  code: string;
  message: string;
  details?: any;
}> {}

/** Ping message */
export interface PingMessage extends StreamingMessage<'ping', {
  interval: number;
}> {}

/** Pong message */
export interface PongMessage extends StreamingMessage<'pong', {
  latency: number;
}> {}

/** Union type for all streaming messages */
export type StreamingMessageUnion = 
  | DataNewMessage
  | DataUpdateMessage
  | DataRemoveMessage
  | MapLayerAddMessage
  | MapLayerUpdateMessage
  | MapLayerRemoveMessage
  | EventNotificationMessage
  | AdapterHealthMessage
  | SystemStatusMessage
  | ErrorMessage
  | PingMessage
  | PongMessage;

/** Client connection */
export interface StreamingClient {
  id: string;
  ws: WebSocket;
  connectedAt: number;
  lastActivity: number;
  subscription: StreamingSubscription;
  userAgent?: string;
  ip?: string;
}

/** Client subscription */
export interface StreamingSubscription {
  adapterIds: string[];
  layerIds: string[];
  eventTypes: string[];
  includeHealthUpdates: boolean;
  includeSystemStatus: boolean;
}

/** Streaming configuration */
export interface StreamingConfig {
  port: number;
  path: string;
  maxConnections: number;
  pingInterval: number;
  maxMessageSize: number;
  connectionTimeout: number;
  enableCompression: boolean;
}

/** Streaming statistics */
export interface StreamingStats {
  totalConnections: number;
  activeConnections: number;
  messagesSent: number;
  messagesReceived: number;
  bytesSent: number;
  bytesReceived: number;
  errors: number;
  uptime: number;
  lastError?: string;
}

// ==========================================================================
// Default Configuration
// ==========================================================================

const DEFAULT_CONFIG: StreamingConfig = {
  port: 3001,
  path: '/api/stream',
  maxConnections: 1000,
  pingInterval: 30000,
  maxMessageSize: 16 * 1024 * 1024, // 16MB
  connectionTimeout: 60000,
  enableCompression: true,
};

// ==========================================================================
// Streaming Server
// ==========================================================================

/** Real-time streaming server for live data updates */
export class StreamingServer {
  private wsServer: WebSocketServer | null = null;
  private clients: Map<string, StreamingClient> = new Map();
  private config: StreamingConfig;
  private eventEmitter: EventEmitter = new EventEmitter();
  private stats: StreamingStats = {
    totalConnections: 0,
    activeConnections: 0,
    messagesSent: 0,
    messagesReceived: 0,
    bytesSent: 0,
    bytesReceived: 0,
    errors: 0,
    uptime: 0,
  };
  private startTime: number = 0;
  private pingInterval: NodeJS.Timeout | null = null;
  private adapterPollers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<StreamingConfig> = {}, private httpServer?: Server) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupEventEmitter();
  }

  /** Setup event emitter listeners */
  private setupEventEmitter(): void {
    // Data events from adapters
    this.eventEmitter.on('data:new', (data: { adapterId: string; asset: DiscoveredAsset | NormalizedProduct; layerId?: string }) => {
      this.broadcastToSubscribers('data:new', data, (client) => 
        client.subscription.adapterIds.includes(data.adapterId) ||
        client.subscription.adapterIds.length === 0
      );
    });

    this.eventEmitter.on('data:update', (data: { adapterId: string; assetId: string; changes: any; layerId?: string }) => {
      this.broadcastToSubscribers('data:update', data, (client) => 
        client.subscription.adapterIds.includes(data.adapterId) ||
        client.subscription.adapterIds.length === 0
      );
    });

    this.eventEmitter.on('data:remove', (data: { adapterId: string; assetId: string; layerId?: string }) => {
      this.broadcastToSubscribers('data:remove', data, (client) => 
        client.subscription.adapterIds.includes(data.adapterId) ||
        client.subscription.adapterIds.length === 0
      );
    });

    // Map layer events
    this.eventEmitter.on('map:layer:add', (data: { layerId: string; layerType: string; adapterId?: string; config: any }) => {
      this.broadcastToSubscribers('map:layer:add', data, (client) => 
        client.subscription.layerIds.includes(data.layerId) ||
        client.subscription.layerIds.length === 0
      );
    });

    this.eventEmitter.on('map:layer:update', (data: { layerId: string; changes: any }) => {
      this.broadcastToSubscribers('map:layer:update', data, (client) => 
        client.subscription.layerIds.includes(data.layerId) ||
        client.subscription.layerIds.length === 0
      );
    });

    this.eventEmitter.on('map:layer:remove', (data: { layerId: string }) => {
      this.broadcastToSubscribers('map:layer:remove', data, (client) => 
        client.subscription.layerIds.includes(data.layerId) ||
        client.subscription.layerIds.length === 0
      );
    });

    // System events
    this.eventEmitter.on('event:notification', (data: { eventType: string; severity: string; title: string; message: string; data?: any }) => {
      this.broadcast('event:notification', data);
    });

    this.eventEmitter.on('adapter:health', (data: { adapterId: string; health: string; healthNote: string; timestamp: number }) => {
      this.broadcastToSubscribers('adapter:health', data, (client) => 
        client.subscription.includeHealthUpdates
      );
    });

    this.eventEmitter.on('system:status', (data: { status: string; components: Record<string, any>; timestamp: number }) => {
      this.broadcastToSubscribers('system:status', data, (client) => 
        client.subscription.includeSystemStatus
      );
    });
  }

  /** Start the streaming server */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (this.wsServer) {
          resolve();
          return;
        }

        // Create WebSocket server
        this.wsServer = new WebSocketServer({
          server: this.httpServer,
          path: this.config.path,
          maxPayload: this.config.maxMessageSize,
          clientTracking: true,
          perMessageDeflate: this.config.enableCompression,
        });

        this.startTime = Date.now();

        // Setup WebSocket event handlers
        this.wsServer.on('connection', this.handleConnection.bind(this));
        this.wsServer.on('error', this.handleServerError.bind(this));

        // Start ping interval
        this.startPingInterval();

        // Start adapter health polling
        this.startAdapterPolling();

        console.log(`[StreamingServer] Started on ${this.config.path}`);
        resolve();
      } catch (error) {
        console.error('[StreamingServer] Failed to start:', error);
        reject(error);
      }
    });
  }

  /** Stop the streaming server */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wsServer) {
        resolve();
        return;
      }

      // Close all client connections
      this.clients.forEach((client) => {
        try {
          client.ws.close(1001, 'Server shutting down');
        } catch (error) {
          // Ignore errors
        }
      });

      this.clients.clear();

      // Stop ping interval
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      // Stop adapter pollers
      this.adapterPollers.forEach((poller) => clearInterval(poller));
      this.adapterPollers.clear();

      // Close WebSocket server
      this.wsServer.close(() => {
        this.wsServer = null;
        console.log('[StreamingServer] Stopped');
        resolve();
      });
    });
  }

  /** Handle new WebSocket connection */
  private handleConnection(ws: WebSocket, req: any): void {
    const clientId = this.generateClientId();
    const ip = req.socket?.remoteAddress;
    const userAgent = req.headers?.['user-agent'];

    const client: StreamingClient = {
      id: clientId,
      ws,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      subscription: {
        adapterIds: [],
        layerIds: [],
        eventTypes: [],
        includeHealthUpdates: true,
        includeSystemStatus: true,
      },
      userAgent,
      ip,
    };

    this.clients.set(clientId, client);
    this.stats.totalConnections++;
    this.stats.activeConnections++;

    console.log(`[StreamingServer] New connection: ${clientId} (IP: ${ip}, UA: ${userAgent})`);

    // Setup message handler
    ws.on('message', (data: WebSocket.RawData) => {
      this.handleMessage(client, data);
    });

    // Setup close handler
    ws.on('close', (code: number, reason: Buffer) => {
      this.handleClose(clientId, code, reason);
    });

    // Setup error handler
    ws.on('error', (error: Error) => {
      this.handleClientError(clientId, error);
    });

    // Send welcome message
    this.sendMessage(client, {
      type: 'system:status',
      timestamp: Date.now(),
      payload: {
        status: 'operational',
        components: {
          streaming: { status: 'live', message: 'Connected successfully' },
        },
        timestamp: Date.now(),
      },
    });

    // Send current adapter health
    this.broadcastAdapterHealth();
  }

  /** Handle incoming message */
  private handleMessage(client: StreamingClient, data: WebSocket.RawData): void {
    try {
      client.lastActivity = Date.now();
      this.stats.messagesReceived++;
      this.stats.bytesReceived += Buffer.byteLength(data);

      // Parse message
      let message: any;
      try {
        message = JSON.parse(data.toString());
      } catch (parseError) {
        this.sendError(client, 'invalid_message', 'Invalid JSON format');
        return;
      }

      // Handle different message types
      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(client, message.payload);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(client, message.payload);
          break;
        case 'ping':
          this.handlePing(client, message);
          break;
        case 'pong':
          // Handle pong (response to our ping)
          break;
        default:
          this.sendError(client, 'unknown_message_type', `Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('[StreamingServer] Message handling error:', error);
      this.stats.errors++;
    }
  }

  /** Handle client disconnect */
  private handleClose(clientId: string, code: number, reason: Buffer): void {
    const client = this.clients.get(clientId);
    if (client) {
      console.log(`[StreamingServer] Connection closed: ${clientId} (Code: ${code})`);
      this.clients.delete(clientId);
      this.stats.activeConnections--;
    }
  }

  /** Handle client error */
  private handleClientError(clientId: string, error: Error): void {
    console.error(`[StreamingServer] Client error: ${clientId}:`, error);
    this.stats.errors++;
    this.clients.delete(clientId);
    this.stats.activeConnections--;
  }

  /** Handle server error */
  private handleServerError(error: Error): void {
    console.error('[StreamingServer] Server error:', error);
    this.stats.errors++;
    this.stats.lastError = error.message;
  }

  /** Handle subscribe message */
  private handleSubscribe(client: StreamingClient, payload: any): void {
    try {
      if (payload.adapterIds) {
        client.subscription.adapterIds = Array.isArray(payload.adapterIds) 
          ? payload.adapterIds 
          : [payload.adapterIds];
      }
      if (payload.layerIds) {
        client.subscription.layerIds = Array.isArray(payload.layerIds) 
          ? payload.layerIds 
          : [payload.layerIds];
      }
      if (payload.eventTypes) {
        client.subscription.eventTypes = Array.isArray(payload.eventTypes) 
          ? payload.eventTypes 
          : [payload.eventTypes];
      }
      if (payload.includeHealthUpdates !== undefined) {
        client.subscription.includeHealthUpdates = payload.includeHealthUpdates;
      }
      if (payload.includeSystemStatus !== undefined) {
        client.subscription.includeSystemStatus = payload.includeSystemStatus;
      }

      console.log(`[StreamingServer] Client ${client.id} subscribed:`, client.subscription);

      // Send current state for subscribed adapters
      this.sendCurrentAdapterState(client);
    } catch (error) {
      this.sendError(client, 'subscription_error', 'Invalid subscription payload');
    }
  }

  /** Handle unsubscribe message */
  private handleUnsubscribe(client: StreamingClient, payload: any): void {
    try {
      if (payload.adapterIds) {
        const adapterIds = Array.isArray(payload.adapterIds) 
          ? payload.adapterIds 
          : [payload.adapterIds];
        client.subscription.adapterIds = client.subscription.adapterIds.filter(
          id => !adapterIds.includes(id)
        );
      }
      if (payload.layerIds) {
        const layerIds = Array.isArray(payload.layerIds) 
          ? payload.layerIds 
          : [payload.layerIds];
        client.subscription.layerIds = client.subscription.layerIds.filter(
          id => !layerIds.includes(id)
        );
      }

      console.log(`[StreamingServer] Client ${client.id} unsubscribed:`, client.subscription);
    } catch (error) {
      this.sendError(client, 'unsubscription_error', 'Invalid unsubscribe payload');
    }
  }

  /** Handle ping message */
  private handlePing(client: StreamingClient, message: any): void {
    this.sendMessage(client, {
      type: 'pong',
      timestamp: Date.now(),
      payload: {
        latency: Date.now() - message.timestamp,
      },
    });
  }

  /** Start ping interval for all clients */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      
      this.clients.forEach((client) => {
        // Check if client is still connected
        if (client.ws.readyState === WebSocket.OPEN) {
          this.sendMessage(client, {
            type: 'ping',
            timestamp: now,
            payload: {
              interval: this.config.pingInterval,
            },
          });
        }
      });
    }, this.config.pingInterval);
  }

  /** Start adapter health polling */
  private startAdapterPolling(): void {
    // Poll adapter health every 60 seconds
    const pollInterval = setInterval(() => {
      this.broadcastAdapterHealth();
    }, 60000);

    this.adapterPollers.set('health', pollInterval);

    // Also poll for live data updates
    const dataPollInterval = setInterval(() => {
      this.pollAdaptersForUpdates();
    }, 30000);

    this.adapterPollers.set('data', dataPollInterval);
  }

  /** Poll adapters for live data updates */
  private async pollAdaptersForUpdates(): Promise<void> {
    try {
      const liveAdapters = ADAPTERS.filter(a => a.health === 'live');
      
      for (const adapter of liveAdapters) {
        try {
          // For now, just emit health updates
          // In production, this would trigger actual data polling
          this.eventEmitter.emit('adapter:health', {
            adapterId: adapter.id,
            health: adapter.health,
            healthNote: adapter.healthNote,
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error(`[StreamingServer] Error polling adapter ${adapter.id}:`, error);
        }
      }
    } catch (error) {
      console.error('[StreamingServer] Error polling adapters:', error);
    }
  }

  /** Broadcast adapter health to all clients */
  private broadcastAdapterHealth(): void {
    ADAPTERS.forEach(adapter => {
      this.eventEmitter.emit('adapter:health', {
        adapterId: adapter.id,
        health: adapter.health,
        healthNote: adapter.healthNote,
        timestamp: Date.now(),
      });
    });
  }

  /** Send current state for subscribed adapters */
  private sendCurrentAdapterState(client: StreamingClient): void {
    // Send health for all adapters the client is subscribed to
    ADAPTERS.forEach(adapter => {
      if (client.subscription.adapterIds.includes(adapter.id) || 
          client.subscription.adapterIds.length === 0) {
        this.sendMessage(client, {
          type: 'adapter:health',
          timestamp: Date.now(),
          payload: {
            adapterId: adapter.id,
            health: adapter.health,
            healthNote: adapter.healthNote,
            timestamp: Date.now(),
          },
        });
      }
    });
  }

  /** Send message to specific client */
  private sendMessage<T extends StreamingMessageUnion>(client: StreamingClient, message: T): boolean {
    try {
      if (client.ws.readyState !== WebSocket.OPEN) {
        return false;
      }

      const data = JSON.stringify(message);
      const bytes = Buffer.byteLength(data);

      client.ws.send(data);
      this.stats.messagesSent++;
      this.stats.bytesSent += bytes;

      return true;
    } catch (error) {
      console.error('[StreamingServer] Error sending message:', error);
      this.stats.errors++;
      return false;
    }
  }

  /** Broadcast message to all clients */
  broadcast<T extends StreamingMessageUnion>(type: T['type'], payload: T['payload']): number {
    const message = {
      type,
      timestamp: Date.now(),
      payload,
    } as StreamingMessageUnion;

    let sentCount = 0;

    this.clients.forEach((client) => {
      if (this.sendMessage(client, message as any)) {
        sentCount++;
      }
    });

    return sentCount;
  }

  /** Broadcast message to subscribed clients */
  private broadcastToSubscribers<T extends StreamingMessageUnion>(
    type: T['type'],
    payload: T['payload'],
    filterFn: (client: StreamingClient) => boolean
  ): number {
    const message = {
      type,
      timestamp: Date.now(),
      payload,
    } as StreamingMessageUnion;

    let sentCount = 0;

    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN && filterFn(client)) {
        if (this.sendMessage(client, message as any)) {
          sentCount++;
        }
      }
    });

    return sentCount;
  }

  /** Send error to client */
  private sendError(client: StreamingClient, code: string, message: string, details?: any): void {
    this.sendMessage(client, {
      type: 'error',
      timestamp: Date.now(),
      payload: {
        code,
        message,
        details,
      },
    } as ErrorMessage);
  }

  /** Generate unique client ID */
  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /** Get streaming statistics */
  getStats(): StreamingStats {
    return {
      ...this.stats,
      uptime: Date.now() - this.startTime,
    };
  }

  /** Get active connections */
  getActiveConnections(): number {
    return this.stats.activeConnections;
  }

  /** Get all clients */
  getClients(): StreamingClient[] {
    return Array.from(this.clients.values());
  }

  /** Get client by ID */
  getClient(clientId: string): StreamingClient | undefined {
    return this.clients.get(clientId);
  }

  /** Emit data new event */
  emitDataNew(adapterId: string, asset: DiscoveredAsset | NormalizedProduct, layerId?: string): void {
    this.eventEmitter.emit('data:new', { adapterId, asset, layerId });
  }

  /** Emit data update event */
  emitDataUpdate(adapterId: string, assetId: string, changes: any, layerId?: string): void {
    this.eventEmitter.emit('data:update', { adapterId, assetId, changes, layerId });
  }

  /** Emit data remove event */
  emitDataRemove(adapterId: string, assetId: string, layerId?: string): void {
    this.eventEmitter.emit('data:remove', { adapterId, assetId, layerId });
  }

  /** Emit map layer add event */
  emitMapLayerAdd(layerId: string, layerType: string, adapterId?: string, config?: any): void {
    this.eventEmitter.emit('map:layer:add', { layerId, layerType, adapterId, config });
  }

  /** Emit map layer update event */
  emitMapLayerUpdate(layerId: string, changes: any): void {
    this.eventEmitter.emit('map:layer:update', { layerId, changes });
  }

  /** Emit map layer remove event */
  emitMapLayerRemove(layerId: string): void {
    this.eventEmitter.emit('map:layer:remove', { layerId });
  }

  /** Emit event notification */
  emitNotification(
    eventType: string,
    severity: 'info' | 'warning' | 'error' | 'critical',
    title: string,
    message: string,
    data?: any
  ): void {
    this.eventEmitter.emit('event:notification', {
      eventType,
      severity,
      title,
      message,
      data,
    });
  }

  /** Emit adapter health update */
  emitAdapterHealth(adapterId: string, health: string, healthNote: string): void {
    this.eventEmitter.emit('adapter:health', {
      adapterId,
      health,
      healthNote,
      timestamp: Date.now(),
    });
  }

  /** Emit system status update */
  emitSystemStatus(status: string, components: Record<string, { status: string; message?: string }>): void {
    this.eventEmitter.emit('system:status', {
      status,
      components,
      timestamp: Date.now(),
    });
  }

  /** Check if adapter is being streamed */
  isAdapterStreamed(adapterId: string): boolean {
    let isStreamed = false;
    
    this.clients.forEach((client) => {
      if (client.subscription.adapterIds.includes(adapterId)) {
        isStreamed = true;
      }
    });

    return isStreamed;
  }

  /** Get subscribers for adapter */
  getAdapterSubscribers(adapterId: string): StreamingClient[] {
    const subscribers: StreamingClient[] = [];
    
    this.clients.forEach((client) => {
      if (client.subscription.adapterIds.includes(adapterId)) {
        subscribers.push(client);
      }
    });

    return subscribers;
  }
}

// ==========================================================================
// Singleton Instance
// ==========================================================================

let streamingServerInstance: StreamingServer | null = null;

/** Get singleton streaming server instance */
export function getStreamingServer(httpServer?: Server): StreamingServer {
  if (!streamingServerInstance) {
    streamingServerInstance = new StreamingServer({}, httpServer);
  }
  
  // Update HTTP server if provided
  if (httpServer && streamingServerInstance) {
    streamingServerInstance['httpServer'] = httpServer;
    if (streamingServerInstance.wsServer) {
      streamingServerInstance.wsServer.close();
      streamingServerInstance.wsServer = null;
    }
    streamingServerInstance.start();
  }

  return streamingServerInstance;
}

/** Reset singleton instance (for testing) */
export function resetStreamingServer(): void {
  if (streamingServerInstance) {
    streamingServerInstance.stop();
  }
  streamingServerInstance = null;
}

// ==========================================================================
// SSE (Server-Sent Events) Support
// ==========================================================================

/** SSE Client for clients that don't support WebSocket */
export class SSEClient {
  private res: any;
  private id: string;
  private lastEventId: string = '';

  constructor(res: any, id: string) {
    this.res = res;
    this.id = id;
  }

  send(event: string, data: any, id?: string): void {
    const message = id ? `id: ${id}\n` : '';
    const eventLine = `event: ${event}\n`;
    const dataLine = `data: ${JSON.stringify(data)}\n\n`;
    
    this.res.write(message + eventLine + dataLine);
    if (id) {
      this.lastEventId = id;
    }
  }

  close(): void {
    this.res.end();
  }
}

/** SSE Manager for handling multiple SSE connections */
export class SSEManager {
  private clients: Map<string, SSEClient> = new Map();
  private streamingServer: StreamingServer;

  constructor(streamingServer: StreamingServer) {
    this.streamingServer = streamingServer;
  }

  addClient(res: any): SSEClient {
    const id = `sse-${Date.now()}`;
    const client = new SSEClient(res, id);
    this.clients.set(id, client);
    
    // Forward streaming events to SSE
    this.setupEventForwarding(client);

    return client;
  }

  private setupEventForwarding(client: SSEClient): void {
    const streaming = this.streamingServer;
    
    const eventTypes = [
      'data:new', 'data:update', 'data:remove',
      'map:layer:add', 'map:layer:update', 'map:layer:remove',
      'event:notification', 'adapter:health', 'system:status'
    ] as const;

    eventTypes.forEach(type => {
      streaming.eventEmitter.on(type, (data: any) => {
        client.send(type, data);
      });
    });
  }

  removeClient(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      client.close();
      this.clients.delete(id);
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

// ==========================================================================
// Streaming API Handlers
// ==========================================================================

/** Create WebSocket upgrade handler for HTTP server */
export function createWebSocketHandler(httpServer: Server, config?: Partial<StreamingConfig>): void {
  const streamingServer = getStreamingServer(httpServer);
  Object.assign(streamingServer.config, config);
  streamingServer.start().catch(console.error);
}

/** Create SSE handler for HTTP server */
export function createSSEHandler(req: any, res: any): void {
  const streamingServer = getStreamingServer();
  const sseManager = new SSEManager(streamingServer);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

  const client = sseManager.addClient(res);

  // Send initial data
  client.send('system:status', {
    status: 'operational',
    timestamp: Date.now(),
  });

  // Handle client disconnect
  req.on('close', () => {
    sseManager.removeClient(client.id);
  });
}

// ==========================================================================
// Message Builders
// ==========================================================================

/** Build data new message */
export function buildDataNewMessage(
  adapterId: string,
  asset: DiscoveredAsset | NormalizedProduct,
  layerId?: string
): DataNewMessage {
  return {
    type: 'data:new',
    timestamp: Date.now(),
    payload: { adapterId, asset, layerId },
  };
}

/** Build data update message */
export function buildDataUpdateMessage(
  adapterId: string,
  assetId: string,
  changes: any,
  layerId?: string
): DataUpdateMessage {
  return {
    type: 'data:update',
    timestamp: Date.now(),
    payload: { adapterId, assetId, changes, layerId },
  };
}

/** Build data remove message */
export function buildDataRemoveMessage(
  adapterId: string,
  assetId: string,
  layerId?: string
): DataRemoveMessage {
  return {
    type: 'data:remove',
    timestamp: Date.now(),
    payload: { adapterId, assetId, layerId },
  };
}

/** Build notification message */
export function buildNotificationMessage(
  eventType: string,
  severity: 'info' | 'warning' | 'error' | 'critical',
  title: string,
  message: string,
  data?: any
): EventNotificationMessage {
  return {
    type: 'event:notification',
    timestamp: Date.now(),
    payload: { eventType, severity, title, message, data },
  };
}

/** Build adapter health message */
export function buildAdapterHealthMessage(
  adapterId: string,
  health: 'live' | 'degraded' | 'blocked' | 'error',
  healthNote: string
): AdapterHealthMessage {
  return {
    type: 'adapter:health',
    timestamp: Date.now(),
    payload: { adapterId, health, healthNote, timestamp: Date.now() },
  };
}

/** Build system status message */
export function buildSystemStatusMessage(
  status: 'operational' | 'degraded' | 'maintenance' | 'error',
  components: Record<string, { status: string; message?: string }>
): SystemStatusMessage {
  return {
    type: 'system:status',
    timestamp: Date.now(),
    payload: { status, components, timestamp: Date.now() },
  };
}

export default {
  StreamingServer,
  getStreamingServer,
  resetStreamingServer,
  createWebSocketHandler,
  createSSEHandler,
  SSEManager,
  SSEClient,
  // Types
  StreamingMessage,
  StreamingMessageType,
  StreamingMessageUnion,
  DataNewMessage,
  DataUpdateMessage,
  DataRemoveMessage,
  MapLayerAddMessage,
  MapLayerUpdateMessage,
  MapLayerRemoveMessage,
  EventNotificationMessage,
  AdapterHealthMessage,
  SystemStatusMessage,
  ErrorMessage,
  PingMessage,
  PongMessage,
  StreamingClient,
  StreamingSubscription,
  StreamingConfig,
  StreamingStats,
  // Message builders
  buildDataNewMessage,
  buildDataUpdateMessage,
  buildDataRemoveMessage,
  buildNotificationMessage,
  buildAdapterHealthMessage,
  buildSystemStatusMessage,
};
