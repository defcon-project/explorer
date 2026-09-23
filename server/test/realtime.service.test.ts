import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { RealtimeService } from '../src/services/realtime.service';

type TestSocket = EventEmitter & {
  connectionId?: string;
  isAlive?: boolean;
  remoteIp?: string;
  slotReleased?: boolean;
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
};

type RealtimeServiceInternals = {
  handleConnection: (client: TestSocket) => void;
  sendInitialSyncStatus: (client: TestSocket) => Promise<void>;
  perIpCount: Map<string, number>;
};

function createSocket(ip = '203.0.113.10'): TestSocket {
  const socket = new EventEmitter() as TestSocket;
  socket.remoteIp = ip;
  socket.readyState = WebSocket.OPEN;
  socket.send = vi.fn();
  socket.ping = vi.fn();
  socket.terminate = vi.fn();
  return socket;
}

function attach(service: RealtimeService, socket: TestSocket): RealtimeServiceInternals {
  const internals = service as unknown as RealtimeServiceInternals;
  vi.spyOn(internals, 'sendInitialSyncStatus').mockResolvedValue(undefined);
  const ip = socket.remoteIp!;
  internals.perIpCount.set(ip, (internals.perIpCount.get(ip) ?? 0) + 1);
  internals.handleConnection(socket);
  return internals;
}

describe('RealtimeService connection slots', () => {
  it('releases an IP slot once when websocket error is followed by close', () => {
    const service = new RealtimeService();
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    const internals = attach(service, firstSocket);
    attach(service, secondSocket);

    firstSocket.emit('error', new Error('socket reset'));
    firstSocket.emit('close');

    expect(service.getConnectionStats()).toMatchObject({ connectedClients: 1, ipBuckets: 1 });
    expect(internals.perIpCount.get(firstSocket.remoteIp!)).toBe(1);

    secondSocket.emit('close');
    expect(service.getConnectionStats()).toMatchObject({ connectedClients: 0, ipBuckets: 0 });
  });

  it('releases the IP slot when a socket is no longer open during broadcast', () => {
    const service = new RealtimeService();
    const socket = createSocket();
    const internals = attach(service, socket);
    socket.readyState = WebSocket.CLOSED;

    service.publishNewTx({
      txid: 'a'.repeat(64),
      blockHash: 'b'.repeat(64),
      blockHeight: 1,
      blockTime: 1,
    });

    expect(service.getConnectionStats()).toMatchObject({ connectedClients: 0, ipBuckets: 0 });
    expect(internals.perIpCount.has(socket.remoteIp!)).toBe(false);
  });
});
