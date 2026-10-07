import { rpcService } from '../src/services/rpc.service';
import { MasternodeEvent } from '../src/models/MasternodeEvent';
import { NodeInventory } from '../src/models/NodeInventory';
import { getOperatorDiagnosis } from '../src/services/operatorDiagnosis.service';
vi.mock('../src/services/rpc.service', () => ({ rpcService: { call: vi.fn() } }));
const now = new Date('2026-10-07T12:00:00Z'), id = 'a'.repeat(64);
describe('operator diagnosis source boundaries', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('uses registered RPC only, bounded retained ban metadata, and shares cached results', async () => {
    vi.mocked(rpcService.call).mockResolvedValue([{ proTxHash: id,
      state: { service: '198.51.100.1:8192', PoSePenalty: 50, PoSeBanHeight: -1, dslBanHeight: -1 } }]);
    const limit = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    vi.spyOn(MasternodeEvent, 'find').mockReturnValue({ sort: vi.fn().mockReturnValue({ limit }) } as never);
    vi.spyOn(NodeInventory, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([]) } as never);
    const results = await Promise.all([getOperatorDiagnosis(), getOperatorDiagnosis()]);
    expect(results[0]).toBe(results[1]); expect(rpcService.call).toHaveBeenCalledTimes(1);
    expect(rpcService.call).toHaveBeenCalledWith('protx', ['list', 'registered', 1]);
    expect(limit).toHaveBeenCalledWith(10001); expect(results[0].maxPenalty).toBe(100);
    expect(results[0].nodes[0].operatorDiagnosis[0].code).toBe('BAN_NEXT_DKG');
    expect(await getOperatorDiagnosis()).toBe(results[0]);
  });
  it('never returns an old action snapshot after RPC failure or incomplete state', async () => {
    const find = vi.spyOn(MasternodeEvent, 'find');
    vi.setSystemTime(new Date(now.getTime() + 31000));
    vi.mocked(rpcService.call).mockRejectedValue(new Error('RPC unavailable'));
    await expect(getOperatorDiagnosis()).rejects.toThrow('RPC unavailable');
    vi.mocked(rpcService.call).mockResolvedValue([{ proTxHash: id, state: { PoSePenalty: 50 } }]);
    await expect(getOperatorDiagnosis()).rejects.toThrow();
    expect(find).not.toHaveBeenCalled();
  });
});
