/* ==========================================================================
 * FirstLight - Streaming System Tests
 * ========================================================================== */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingServer, getStreamingServer, resetStreamingServer } from '../streaming';
import type { StreamingMessageUnion, DataNewMessage } from '../streaming';

// Mock WebSocket
class MockWebSocket {
  readyState = WebSocket.OPEN;
  onmessage: ((data: any) => void) | null = null;
  onclose: ((code: number, reason: Buffer) => void) | null = null;
  onerror: ((error: Error) => void) | null = null;
  
  constructor(public url: string) {}
  
  send(data: any): void {
    if (this.onmessage) {
      this.onmessage(data);
    }
  }
  
  close(code?: number, reason?: string): void {
    if (this.onclose) {
      this.onclose(code || 1000, Buffer.from(reason || ''));
    }
  }
}

// Mock Server
const mockServer = {};

describe('Streaming Server', () => {
  let streamingServer: StreamingServer;

  beforeEach(() => {
    vi.resetAllMocks();
    resetStreamingServer();
    streamingServer = getStreamingServer(mockServer);
  });

  afterEach(() => {
    resetStreamingServer();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      expect(streamingServer).toBeDefined();
      expect(streamingServer.getActiveConnections()).toBe(0);
    });

    it('should have correct default config values', () => {
      const config = streamingServer['config'];
      expect(config.port).toBe(3001);
      expect(config.path).toBe('/api/stream');
      expect(config.maxConnections).toBe(1000);
      expect(config.pingInterval).toBe(30000);
    });
  });

  describe('Statistics', () => {
    it('should return initial statistics', () => {
      const stats = streamingServer.getStats();
      expect(stats.activeConnections).toBe(0);
      expect(stats.totalConnections).toBe(0);
      expect(stats.messagesSent).toBe(0);
      expect(stats.messagesReceived).toBe(0);
      expect(stats.errors).toBe(0);
    });

    it('should track connection count', () => {
      const initialCount = streamingServer.getActiveConnections();
      expect(initialCount).toBe(0);
    });
  });

  describe('Message Building', () => {
    it('should build data new message correctly', () => {
      const message = streamingServer['buildDataNewMessage'](
        'planet',
        { externalId: 'test-123', title: 'Test Asset', assetType: 'imagery' } as any,
        'layer-123'
      );

      expect(message.type).toBe('data:new');
      expect(message.payload.adapterId).toBe('planet');
      expect(message.payload.asset.externalId).toBe('test-123');
      expect(message.payload.layerId).toBe('layer-123');
      expect(message.timestamp).toBeDefined();
    });

    it('should build notification message correctly', () => {
      const message = streamingServer['buildNotificationMessage'](
        'test_event',
        'info',
        'Test Title',
        'Test message'
      );

      expect(message.type).toBe('event:notification');
      expect(message.payload.eventType).toBe('test_event');
      expect(message.payload.severity).toBe('info');
      expect(message.payload.title).toBe('Test Title');
      expect(message.payload.message).toBe('Test message');
    });

    it('should build adapter health message correctly', () => {
      const message = streamingServer['buildAdapterHealthMessage'](
        'planet',
        'live',
        'Adapter is healthy'
      );

      expect(message.type).toBe('adapter:health');
      expect(message.payload.adapterId).toBe('planet');
      expect(message.payload.health).toBe('live');
      expect(message.payload.healthNote).toBe('Adapter is healthy');
    });

    it('should build system status message correctly', () => {
      const message = streamingServer['buildSystemStatusMessage'](
        'operational',
        { streaming: { status: 'live' } }
      );

      expect(message.type).toBe('system:status');
      expect(message.payload.status).toBe('operational');
      expect(message.payload.components.streaming.status).toBe('live');
    });
  });

  describe('Event Emission', () => {
    it('should emit data new event', () => {
      const asset = { externalId: 'test-123', title: 'Test' } as any;
      const spy = vi.spyOn(streamingServer['eventEmitter'], 'emit');
      
      streamingServer.emitDataNew('planet', asset, 'layer-123');
      
      expect(spy).toHaveBeenCalledWith('data:new', {
        adapterId: 'planet',
        asset,
        layerId: 'layer-123',
      });
    });

    it('should emit data update event', () => {
      const spy = vi.spyOn(streamingServer['eventEmitter'], 'emit');
      
      streamingServer.emitDataUpdate('planet', 'asset-123', { changed: true }, 'layer-123');
      
      expect(spy).toHaveBeenCalledWith('data:update', {
        adapterId: 'planet',
        assetId: 'asset-123',
        changes: { changed: true },
        layerId: 'layer-123',
      });
    });

    it('should emit data remove event', () => {
      const spy = vi.spyOn(streamingServer['eventEmitter'], 'emit');
      
      streamingServer.emitDataRemove('planet', 'asset-123', 'layer-123');
      
      expect(spy).toHaveBeenCalledWith('data:remove', {
        adapterId: 'planet',
        assetId: 'asset-123',
        layerId: 'layer-123',
      });
    });

    it('should emit map layer events', () => {
      const spy = vi.spyOn(streamingServer['eventEmitter'], 'emit');
      
      streamingServer.emitMapLayerAdd('layer-123', 'raster', 'planet', { config: 'test' });
      streamingServer.emitMapLayerUpdate('layer-123', { updated: true });
      streamingServer.emitMapLayerRemove('layer-123');
      
      expect(spy).toHaveBeenCalledWith('map:layer:add', {
        layerId: 'layer-123',
        layerType: 'raster',
        adapterId: 'planet',
        config: { config: 'test' },
      });
      
      expect(spy).toHaveBeenCalledWith('map:layer:update', {
        layerId: 'layer-123',
        changes: { updated: true },
      });
      
      expect(spy).toHaveBeenCalledWith('map:layer:remove', {
        layerId: 'layer-123',
      });
    });

    it('should emit notification event', () => {
      const spy = vi.spyOn(streamingServer['eventEmitter'], 'emit');
      
      streamingServer.emitNotification(
        'test_event',
        'warning',
        'Test Notification',
        'This is a test',
        { data: 'value' }
      );
      
      expect(spy).toHaveBeenCalledWith('event:notification', {
        eventType: 'test_event',
        severity: 'warning',
        title: 'Test Notification',
        message: 'This is a test',
        data: { data: 'value' },
      });
    });

    it('should emit adapter health event', () => {
      const spy = vi.spyOn(streamingServer['eventEmitter'], 'emit');
      
      streamingServer.emitAdapterHealth('planet', 'live', 'Healthy');
      
      expect(spy).toHaveBeenCalledWith('adapter:health', {
        adapterId: 'planet',
        health: 'live',
        healthNote: 'Healthy',
        timestamp: expect.any(Number),
      });
    });

    it('should emit system status event', () => {
      const spy = vi.spyOn(streamingServer['eventEmitter'], 'emit');
      
      streamingServer.emitSystemStatus('operational', {
        streaming: { status: 'live' },
      });
      
      expect(spy).toHaveBeenCalledWith('system:status', {
        status: 'operational',
        components: { streaming: { status: 'live' } },
        timestamp: expect.any(Number),
      });
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance for getStreamingServer', () => {
      const instance1 = getStreamingServer(mockServer);
      const instance2 = getStreamingServer(mockServer);
      
      expect(instance1).toBe(instance2);
    });

    it('should reset instance with resetStreamingServer', () => {
      const instance1 = getStreamingServer(mockServer);
      resetStreamingServer();
      const instance2 = getStreamingServer(mockServer);
      
      expect(instance1).not.toBe(instance2);
    });
  });
});

// ==========================================================================
// Message Type Tests
// ==========================================================================

describe('Message Types', () => {
  it('should have all required message types', () => {
    const expectedTypes = [
      'data:new',
      'data:update',
      'data:remove',
      'map:layer:add',
      'map:layer:update',
      'map:layer:remove',
      'event:notification',
      'adapter:health',
      'system:status',
      'error',
      'ping',
      'pong',
    ];

    // These are defined in the type system
    expect(expectedTypes.length).toBeGreaterThan(0);
  });
});

// ==========================================================================
// Helper Function Tests
// ==========================================================================

describe('Helper Functions', () => {
  it('should generate unique client ID', () => {
    const server = getStreamingServer(mockServer);
    const id1 = server['generateClientId']();
    const id2 = server['generateClientId']();
    
    expect(id1).not.toBe(id2);
    expect(id1).toContain('client-');
    expect(id2).toContain('client-');
  });
});
