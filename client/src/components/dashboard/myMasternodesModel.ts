import type { MasternodesView } from '../../types/api';
import { serviceText } from '../../pages/masternodes/serviceText';

type SnapshotNode = MasternodesView['nodes'][number];

/** The home page band shows this many starred masternodes; the rest wait in the Masternodes table. */
export const BAND_MAX_ITEMS = 8;

/**
 * One starred registration as the current masternode list shows it:
 * - `listed`: in the list, with its status as the list gives it (upper case);
 * - `missing`: the list arrived but does not have it (removed, or registered again under a new proTxHash);
 * - `unknown`: the list did not arrive, so nothing is known about it.
 */
export type StarredNode =
  | { proTxHash: string; state: 'listed'; service: string; status: string }
  | { proTxHash: string; state: 'missing' }
  | { proTxHash: string; state: 'unknown' };

/** Lower numbers come first: a banned or vanished node before one under penalty, enabled ones last. */
function rank(node: StarredNode): number {
  if (node.state === 'unknown') return 0;
  if (node.state === 'missing') return 1;
  if (node.status === 'POSE_BANNED') return 0;
  if (node.status === 'POSE_PENALTY') return 2;
  if (node.status === 'ENABLED') return 4;
  return 3;
}

/**
 * The starred registrations matched to the list by proTxHash (never by IP). `nodes` is null when the
 * list is not available. The order puts the nodes that need a look first; equal ones keep the order
 * in which they were starred.
 */
export function starredNodes(favorites: readonly string[], nodes: readonly SnapshotNode[] | null): StarredNode[] {
  if (!nodes) return favorites.map((proTxHash) => ({ proTxHash, state: 'unknown' }));
  const byProTx = new Map<string, SnapshotNode>();
  for (const node of nodes) {
    const key = typeof node?.proTxHash === 'string' ? node.proTxHash.toLowerCase() : '';
    if (key && !byProTx.has(key)) byProTx.set(key, node);
  }
  const matched: StarredNode[] = favorites.map((proTxHash) => {
    const node = byProTx.get(proTxHash);
    if (!node) return { proTxHash, state: 'missing' };
    const status = String(node.status ?? '').trim().toUpperCase() || 'UNKNOWN';
    return { proTxHash, state: 'listed', service: serviceText(node), status };
  });
  // Array.prototype.sort is stable, so equal ranks keep the starring order.
  return matched.sort((a, b) => rank(a) - rank(b));
}

/** How many starred nodes share each status, in the band's order: "2 Enabled", "1 Not in the list". */
export function statusCounts(nodes: readonly StarredNode[], label: (node: StarredNode) => string): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const key = label(node);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => ({ label: key, count }));
}
