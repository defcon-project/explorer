import {
  mapBanWaveNode,
  mapStoredBanEvent,
  type LiveBanNodeSnapshot,
} from '../src/domain/pose/banPresentation';

const liveNode: LiveBanNodeSnapshot = {
  id: 'node-a',
  status: 'ENABLED',
  service: '10.0.0.1:8192',
  proTxHash: 'protx-a',
  ip: '10.0.0.1',
  countryCode: 'DE',
  countryName: 'Germany',
  provider: 'Contabo',
  providerConfidence: 90,
};

describe('PoSe ban presentation mapping', () => {
  it('keeps stored event values and fills missing metadata from the live snapshot', () => {
    const detectedAt = new Date('2026-07-01T10:00:00.000Z');
    const event = mapStoredBanEvent(
      {
        nodeId: 'node-a',
        previousStatus: 'ENABLED',
        currentStatus: 'POSE_BANNED',
        detectedAt,
        poseBanHeight: 100,
      },
      liveNode
    );

    expect(event).toEqual(
      expect.objectContaining({
        nodeId: 'node-a',
        proTxHash: 'protx-a',
        service: '10.0.0.1:8192',
        provider: 'Contabo',
        eventStatus: 'recovered',
        at: detectedAt.getTime(),
      })
    );
  });

  it('enriches historical wave nodes with persisted version observations', () => {
    const event = mapStoredBanEvent(
      {
        nodeId: 'node-a',
        previousStatus: 'POSE_PENALTY',
        currentStatus: 'POSE_BANNED',
        detectedAt: new Date('2026-07-01T10:00:00.000Z'),
        eventStatus: 'banned',
      },
      { ...liveNode, status: 'POSE_BANNED' }
    );
    const node = mapBanWaveNode(event, { ...liveNode, status: 'POSE_BANNED' }, {
      walletVersion: '22.1.4',
      protocolVersion: 70239,
      lastObservedAt: new Date('2026-07-01T10:05:00.000Z'),
    });

    expect(node).toEqual(
      expect.objectContaining({
        status: 'still_banned',
        walletVersion: '22.1.4',
        protocolVersion: 70239,
        versionObservedAt: '2026-07-01T10:05:00.000Z',
      })
    );
  });
});
