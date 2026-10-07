import type { OperatorDiagnosisData } from '@defcon/shared/dist/contracts';
import { rpcService } from './rpc.service';
import { MasternodeEvent } from '../models/MasternodeEvent';
import { NodeInventory } from '../models/NodeInventory';
import { diagnoseOperator, inventoryForOperator, parseOperatorRegistry } from '../domain/pose/operatorDiagnosis';
import { createSingleFlight } from '../utils/singleFlight';

const singleFlight = createSingleFlight<OperatorDiagnosisData>();
let cached: { at: number; data: OperatorDiagnosisData } | null = null;
export async function getOperatorDiagnosis(): Promise<OperatorDiagnosisData> {
  if (cached && Date.now() - cached.at < 30000) return cached.data;
  return singleFlight.run(async () => {
    // No valid-list/fallback count: the dynamic penalty cap requires the full registry.
    const registry = parseOperatorRegistry(await rpcService.call('protx', ['list', 'registered', 1]));
    const now = new Date(), historySince = new Date(now.getTime() - 90 * 86400000);
    const ids = registry.map(n => n.proTxHash);
    const [history, inventory] = await Promise.all([
      MasternodeEvent.find({ eventType: 'ban', proTxHash: { $in: ids }, detectedAt: { $gte: historySince, $lte: now } },
        { proTxHash: 1, poseBanHeight: 1, recoveredHeight: 1, recoveredAt: 1, detectedAt: 1, _id: 0 })
        .sort({ detectedAt: -1 }).limit(10001).lean(),
      NodeInventory.find({ masternodeProTxHash: { $in: ids } },
        { ip: 1, port: 1, masternodeProTxHash: 1, walletVersion: 1, lastVersionObservedAt: 1,
          chainStatus: 1, lastObservedAt: 1, _id: 0 }).lean(),
    ]);
    const historyById = new Map<string, typeof history>();
    for (const event of history.slice(0, 10000)) {
      const key = event.proTxHash?.toLowerCase(); if (!key) continue;
      const rows = historyById.get(key) ?? []; rows.push(event); historyById.set(key, rows);
    }
    const inventoryByEndpoint = new Map(inventory.map(row => [`${row.ip}:${row.port}`, row]));
    const data: OperatorDiagnosisData = {
      generatedAt: now.toISOString(), registeredCount: registry.length, maxPenalty: Math.max(100, registry.length),
      historySince: historySince.toISOString(), historyLimited: true,
      nodes: registry.map(node => ({ proTxHash: node.proTxHash, service: node.state.service,
        operatorDiagnosis: diagnoseOperator(node, registry.length, now, historyById.get(node.proTxHash) ?? [],
          inventoryForOperator(node, [inventoryByEndpoint.get(node.state.service.replace(/^\[([^\]]+)\]/, '$1'))].filter(row => row !== undefined))) })),
    };
    cached = { at: Date.now(), data };
    return data;
  });
}
