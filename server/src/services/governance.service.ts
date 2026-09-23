import { rpcService } from './rpc.service';

type RpcRecord = Record<string, unknown>;

export type SporkGovernanceSnapshot = {
  checkedAt: number;
  capabilities: {
    sporkShow: boolean;
    sporkActive: boolean;
    governanceInfo: boolean;
  };
  sporks: {
    scheduled: RpcRecord | null;
    active: RpcRecord | null;
  };
  governanceInfo: RpcRecord | null;
  warnings: string[];
};

export type GovernanceObjectSummary = {
  hash: string;
  dataHex: string | null;
  dataStringPreview: string | null;
  yesCount: number | null;
  noCount: number | null;
  abstainCount: number | null;
  absoluteYesCount: number | null;
  objectType: string | null;
  cachedFunding: boolean | null;
  cachedValid: boolean | null;
  cachedDelete: boolean | null;
  createdAt: number | null;
  raw?: unknown;
};

export type GovernanceObjectsView = {
  checkedAt: number;
  signal: string;
  objectType: string;
  limit: number;
  total: number;
  returned: number;
  objects: GovernanceObjectSummary[];
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNullableBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true' || lowered === '1') return true;
    if (lowered === 'false' || lowered === '0') return false;
  }
  return null;
}

function pickRecordValue(record: RpcRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

function stringPreview(value: string | null, maxLen = 200): string | null {
  if (!value) return null;
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}...`;
}

function parseGovernanceObject(hash: string, raw: unknown, includeRaw: boolean): GovernanceObjectSummary {
  let dataHex: string | null = null;
  let dataStringPreview: string | null = null;
  let yesCount: number | null = null;
  let noCount: number | null = null;
  let abstainCount: number | null = null;
  let absoluteYesCount: number | null = null;
  let objectType: string | null = null;
  let cachedFunding: boolean | null = null;
  let cachedValid: boolean | null = null;
  let cachedDelete: boolean | null = null;
  let createdAt: number | null = null;

  if (typeof raw === 'string') {
    const parts = raw.split('|').map((part) => part.trim());
    const [part0, part1] = parts;
    dataHex = toNullableString(part0);
    dataStringPreview = stringPreview(toNullableString(part1));

    const numericParts = parts
      .map((part) => toFiniteNumber(part))
      .filter((value): value is number => value != null);
    if (numericParts.length >= 4) {
      yesCount = numericParts[0] ?? null;
      noCount = numericParts[1] ?? null;
      abstainCount = numericParts[2] ?? null;
      absoluteYesCount = numericParts[3] ?? null;
    }
  } else if (raw && typeof raw === 'object') {
    const record = raw as RpcRecord;
    dataHex = toNullableString(pickRecordValue(record, ['DataHex', 'dataHex', 'hex']));
    dataStringPreview = stringPreview(
      toNullableString(pickRecordValue(record, ['DataString', 'dataString', 'name', 'title']))
    );
    yesCount = toFiniteNumber(pickRecordValue(record, ['YesCount', 'yesCount', 'yes']));
    noCount = toFiniteNumber(pickRecordValue(record, ['NoCount', 'noCount', 'no']));
    abstainCount = toFiniteNumber(pickRecordValue(record, ['AbstainCount', 'abstainCount', 'abstain']));
    absoluteYesCount = toFiniteNumber(
      pickRecordValue(record, ['AbsoluteYesCount', 'absoluteYesCount', 'absoluteYes'])
    );
    objectType = toNullableString(pickRecordValue(record, ['ObjectType', 'objectType', 'type']));
    cachedFunding = toNullableBoolean(pickRecordValue(record, ['fCachedFunding', 'cachedFunding']));
    cachedValid = toNullableBoolean(pickRecordValue(record, ['fCachedValid', 'cachedValid']));
    cachedDelete = toNullableBoolean(pickRecordValue(record, ['fCachedDelete', 'cachedDelete']));
    createdAt = toFiniteNumber(pickRecordValue(record, ['nTime', 'time', 'createdAt', 'creationTime']));
  }

  const summary: GovernanceObjectSummary = {
    hash,
    dataHex,
    dataStringPreview,
    yesCount,
    noCount,
    abstainCount,
    absoluteYesCount,
    objectType,
    cachedFunding,
    cachedValid,
    cachedDelete,
    createdAt,
  };

  if (includeRaw) {
    summary.raw = raw;
  }

  return summary;
}

class GovernanceService {
  async fetchSporkSnapshot(): Promise<SporkGovernanceSnapshot> {
    const [showResult, activeResult, infoResult] = await Promise.allSettled([
      rpcService.call<RpcRecord>('spork', ['show']),
      rpcService.call<RpcRecord>('spork', ['active']),
      rpcService.call<RpcRecord>('getgovernanceinfo'),
    ]);

    // Public response: fixed warning strings only. The RPC error text can
    // contain daemon details; rpcService already logs it server-side.
    const warnings: string[] = [];

    if (showResult.status === 'rejected') {
      warnings.push('spork show unavailable');
    }
    if (activeResult.status === 'rejected') {
      warnings.push('spork active unavailable');
    }
    if (infoResult.status === 'rejected') {
      warnings.push('governance info unavailable');
    }

    const capabilities = {
      sporkShow: showResult.status === 'fulfilled',
      sporkActive: activeResult.status === 'fulfilled',
      governanceInfo: infoResult.status === 'fulfilled',
    };

    return {
      checkedAt: Date.now(),
      capabilities,
      sporks: {
        scheduled: showResult.status === 'fulfilled' ? showResult.value : null,
        active: activeResult.status === 'fulfilled' ? activeResult.value : null,
      },
      governanceInfo: infoResult.status === 'fulfilled' ? infoResult.value : null,
      warnings,
    };
  }

  async fetchGovernanceObjects(options: {
    signal: string;
    objectType: string;
    limit: number;
    includeRaw: boolean;
  }): Promise<GovernanceObjectsView> {
    const args: string[] = ['list'];
    if (options.signal && options.signal !== 'all') args.push(options.signal);
    if (options.objectType && options.objectType !== 'all') args.push(options.objectType);

    const result = await rpcService.call<unknown>('gobject', args);
    const asRecord =
      result && typeof result === 'object' ? (result as Record<string, unknown>) : ({} as Record<string, unknown>);

    const parsed = Object.entries(asRecord)
      .map(([hash, raw]) => parseGovernanceObject(hash, raw, options.includeRaw))
      .sort((a, b) => {
        const aScore = a.absoluteYesCount ?? a.yesCount ?? -1;
        const bScore = b.absoluteYesCount ?? b.yesCount ?? -1;
        if (bScore !== aScore) return bScore - aScore;
        return a.hash.localeCompare(b.hash);
      });

    const limited = parsed.slice(0, options.limit);

    return {
      checkedAt: Date.now(),
      signal: options.signal,
      objectType: options.objectType,
      limit: options.limit,
      total: parsed.length,
      returned: limited.length,
      objects: limited,
    };
  }
}

export const governanceService = new GovernanceService();
