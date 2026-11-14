import type { MasternodesView } from '../../types/api';

type MasternodeNode = MasternodesView['nodes'][number];

/**
 * "IP:port" of a listed node, else the service text the list gives, else "Unknown". Its own module, so
 * the home page can show a node the way the Masternodes table does without loading the table's code.
 */
export function serviceText(node: Pick<MasternodeNode, 'ip' | 'port' | 'service'>): string {
  if (node.ip) return node.port != null ? `${node.ip}:${node.port}` : node.ip;
  return node.service || 'Unknown';
}
