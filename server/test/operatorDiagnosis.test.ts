import { diagnoseOperator, inventoryForOperator, parseOperatorRegistry, type OperatorInventory, type ReviveHistory } from '../src/domain/pose/operatorDiagnosis';
const id = 'a'.repeat(64), now = new Date('2026-10-07T12:00:00Z');
const node = (penalty = 75, ban = -1, dsl = -1) => parseOperatorRegistry([{ proTxHash: id,
  state: { service: '198.51.100.1:8192', PoSePenalty: penalty, PoSeBanHeight: ban, dslBanHeight: dsl } }])[0];
const inventory = (extra = {}): OperatorInventory => ({ ip: '198.51.100.1', port: 8192, masternodeProTxHash: id,
  walletVersion: '22.1.4', lastVersionObservedAt: now, lastObservedAt: now, chainStatus: 'behind', ...extra });
const history = (): ReviveHistory[] => [100, 110, 120, 130].map((h, i) => ({ proTxHash: id, poseBanHeight: h,
  detectedAt: new Date(now.getTime() - 10000 + i * 2000), recoveredHeight: h + 8,
  recoveredAt: new Date(now.getTime() - 9000 + i * 2000) }));
describe('operator diagnoses', () => {
  it('uses the full dynamic registry cap and includes the exact 75-point boundary', () => {
    expect(diagnoseOperator(node(74), 220, now, [])).toEqual([]);
    const result = diagnoseOperator(node(), 220, now, []);
    expect(result[0]).toMatchObject({ code: 'BAN_NEXT_DKG', evidence: 'chain', level: 'action', operatorAction: true, since: now.toISOString() });
    expect(result[0].hint).toContain('1 score-decreasing block');
    expect(diagnoseOperator(node(145), 220, now, [])[0].hint).toContain('71 score-decreasing');
    expect(diagnoseOperator(node(34), 90, now, [])[0].message).toContain('34/100');
    expect(diagnoseOperator(node(75), 400, now, [])).toEqual([]);
  });
  it('never flags PoSe-banned or DSL-banned nodes even above the current maximum', () => {
    expect(diagnoseOperator(node(309, 148000), 220, now, [])).toEqual([]);
    expect(diagnoseOperator(node(220, -1, 148000), 220, now, [])).toEqual([]);
  });
  it('requires complete validated registered state and rejects duplicate or empty registries', () => {
    expect(() => parseOperatorRegistry([])).toThrow();
    expect(() => parseOperatorRegistry([node(), node()])).toThrow();
    const n = node(); delete (n.state as Partial<typeof n.state>).dslBanHeight;
    expect(() => parseOperatorRegistry([n])).toThrow();
  });
  it('requires three distinct height-bound revive/reban pairs and preserves pattern evidence', () => {
    const h = history();
    expect(diagnoseOperator(node(0), 220, now, h).map(d => d.code)).toEqual(['REVIVE_LOOP']);
    expect(diagnoseOperator(node(0), 220, now, h)[0]).toMatchObject({ evidence: 'pattern', operatorAction: false });
    expect(diagnoseOperator(node(0), 220, now, h.slice(0, 3))).toEqual([]);
    expect(diagnoseOperator(node(0), 220, now, [h[0], h[0], h[1]])).toEqual([]);
  });
  it('rejects missing heights, rebound beyond four blocks, and mismatched registrations', () => {
    expect(diagnoseOperator(node(0), 220, now, history().map(h => ({ ...h, recoveredHeight: h.poseBanHeight! + 5 })))).toEqual([]);
    expect(diagnoseOperator(node(0), 220, now, history().map(h => ({ ...h, recoveredHeight: null })))).toEqual([]);
    expect(diagnoseOperator(node(0), 220, now, history().map(h => ({ ...h, proTxHash: 'b'.repeat(64) })))).toEqual([]);
  });
  it('does not reuse a port or registration after IP reassignment', () => {
    expect(inventoryForOperator(node(), [inventory({ port: 9999 })])).toBeUndefined();
    expect(inventoryForOperator(node(), [inventory({ masternodeProTxHash: 'b'.repeat(64) })])).toBeUndefined();
    expect(inventoryForOperator(node(), [inventory()])).toEqual(inventory());
  });
  it('labels old/future/missing version observations without treating them as current proof', () => {
    expect(diagnoseOperator(node(0), 220, now, [], inventory())[0]).toMatchObject({ code: 'OLD_VERSION', evidence: 'probe', operatorAction: false });
    expect(diagnoseOperator(node(0), 220, now, [], inventory({ lastVersionObservedAt: new Date(now.getTime() - 25 * 3600000) }))[0].level).toBe('info');
    expect(diagnoseOperator(node(0), 220, now, [], inventory({ lastVersionObservedAt: null })).some(d => d.code === 'OLD_VERSION')).toBe(false);
    expect(diagnoseOperator(node(0), 220, now, [], inventory({ walletVersion: '23.0.0' })).some(d => d.code === 'OLD_VERSION')).toBe(false);
    expect(diagnoseOperator(node(0), 220, now, [], inventory({ lastVersionObservedAt: new Date(now.getTime() + 1) })).some(d => d.code === 'OLD_VERSION')).toBe(false);
  });
  it('describes behind as lag and a hash mismatch as last-known, never an asserted fork', () => {
    const behind = diagnoseOperator(node(0), 220, now, [], inventory()).find(d => d.code === 'WRONG_CHAIN')!;
    expect(behind.message).toContain('lag alone does not prove a fork'); expect(behind.operatorAction).toBe(false);
    expect(diagnoseOperator(node(0), 220, now, [], inventory({ chainStatus: 'main_chain' })).some(d => d.code === 'WRONG_CHAIN')).toBe(false);
    expect(diagnoseOperator(node(0), 220, now, [], inventory({ chainStatus: 'hash_mismatch' })).at(-1)?.message).toContain('Last-known');
  });
});
