import { z } from 'zod';
import type { OperatorDiagnosis } from '@defcon/shared/dist/contracts';

const height = z.number().int().min(-1).max(2147483647);
export function parseOperatorRegistry(value: unknown) {
  const nodes = z.array(z.object({
    proTxHash: z.string().regex(/^[a-fA-F0-9]{64}$/).transform(s => s.toLowerCase()),
    state: z.object({ service: z.string(), PoSePenalty: z.number().int().nonnegative(),
      PoSeBanHeight: height, dslBanHeight: height }),
  })).min(1).max(20000).parse(value);
  if (new Set(nodes.map(n => n.proTxHash)).size !== nodes.length) throw new Error('Duplicate registration');
  return nodes;
}
export type OperatorNode = ReturnType<typeof parseOperatorRegistry>[number];
export type OperatorInventory = {
  ip: string; port: number; masternodeProTxHash?: string | null;
  walletVersion?: string | null; lastVersionObservedAt?: Date | null;
  chainStatus?: string | null; lastObservedAt?: Date | null;
};
export type ReviveHistory = {
  proTxHash?: string | null; poseBanHeight?: number | null; recoveredHeight?: number | null;
  detectedAt?: Date; recoveredAt?: Date | null;
};

/** Exact endpoint and registration match; a reused IP must not inherit evidence. */
export function inventoryForOperator(node: OperatorNode, rows: OperatorInventory[]) {
  return rows.find(r => node.state.service === (r.ip.includes(':') ? `[${r.ip}]:${r.port}` : `${r.ip}:${r.port}`)
    && (!r.masternodeProTxHash || r.masternodeProTxHash.toLowerCase() === node.proTxHash));
}
const date = (value: Date | null | undefined, now: number) => {
  const t = value?.getTime(); return t != null && Number.isFinite(t) && t <= now ? t : null;
};
export function diagnoseOperator(node: OperatorNode, registeredCount: number, now: Date,
  history: ReviveHistory[], inventory?: OperatorInventory): OperatorDiagnosis[] {
  const results: OperatorDiagnosis[] = [], ms = now.getTime();
  const maximum = Math.max(100, registeredCount), amount = Math.floor(maximum * 66 / 100), threshold = maximum - amount;
  const penalty = node.state.PoSePenalty;
  if (node.state.PoSeBanHeight === -1 && node.state.dslBanHeight === -1 && penalty >= threshold) {
    const blocks = penalty - threshold + 1;
    results.push({ code: 'BAN_NEXT_DKG', level: 'action', evidence: 'chain', since: now.toISOString(),
      source: 'protx list registered', operatorAction: true,
      message: `At the observed penalty (${penalty}/${maximum}), another invalid DKG membership can reach the ban threshold.`,
      hint: `Check DKG connectivity and logs. Below this threshold after ${blocks} score-decreasing block(s), assuming no new penalties, suspension or registry changes. This is a conditional risk, not a ban prediction.` });
  }
  // Recovery belongs to the earlier ban document. Pair stable identities using
  // actual ban/recovery heights, never detection-height or wall-clock estimates.
  const events = history.filter(e => e.proTxHash?.toLowerCase() === node.proTxHash
    && Number.isSafeInteger(e.poseBanHeight) && e.poseBanHeight! > 0 && date(e.detectedAt, ms) != null);
  const bans = new Map(events.map(e => [e.poseBanHeight!, date(e.detectedAt, ms)!]));
  const rebounds = new Map<number, number>();
  for (const e of events) {
    const h = e.recoveredHeight, at = date(e.recoveredAt, ms);
    if (!Number.isSafeInteger(h) || h! <= e.poseBanHeight! || at == null) continue;
    if ([1, 2, 3, 4].some(delta => (bans.get(h! + delta) ?? -1) >= at)) rebounds.set(h!, at);
  }
  const times = [...rebounds.values()].sort((a, b) => a - b);
  if (times.length >= 3) results.push({ code: 'REVIVE_LOOP', level: 'action', evidence: 'pattern',
    since: new Date(times[0]).toISOString(), source: 'MasternodeEvent ban/recovery (90-day retained history)', operatorAction: false,
    message: `${times.length} recorded revivals were followed by another ban within 1–4 blocks.`,
    hint: 'Pause automated revival and investigate the node before reviving again. This history pattern does not identify the ban cause or prove a script is running.' });
  const versionAt = date(inventory?.lastVersionObservedAt, ms);
  const version = inventory?.walletVersion?.match(/^(?:\/?DeFCoN:|v)?(\d+)\.\d+/i);
  if (version && Number(version[1]) < 23 && versionAt != null) results.push({
    code: 'OLD_VERSION', level: ms - versionAt <= 86400000 ? 'warn' : 'info', evidence: 'probe',
    since: new Date(versionAt).toISOString(), source: 'NodeInventory last version observation', operatorAction: false,
    message: `Last observed version: ${inventory?.walletVersion}. This may have changed since the observation.`,
    hint: 'Verify the running daemon version and upgrade if it is still below v23.' });
  const chainAt = date(inventory?.lastObservedAt, ms);
  if (chainAt != null && ['behind', 'hash_mismatch'].includes(inventory?.chainStatus ?? '')) results.push({
    code: 'WRONG_CHAIN', level: 'warn', evidence: 'probe', since: new Date(chainAt).toISOString(),
    source: 'NodeInventory last-known chain classification; inventory update time', operatorAction: false,
    message: inventory?.chainStatus === 'behind' ? 'Last-known inventory state is behind the reference chain; lag alone does not prove a fork.'
      : 'Last-known inventory state has a different hash at the reference height.',
    hint: 'Compare the current height and block hash with the reference node. The inventory update time is not an independent chain-probe timestamp.' });
  return results;
}
