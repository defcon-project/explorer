import { classifySeedBaseline, type SeedNodeStatus } from '../src/services/seedNode.service';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function observation(overrides: Partial<SeedNodeStatus>): SeedNodeStatus {
  return {
    ip: '127.0.0.1',
    label: 'Seed',
    reachable: true,
    fetchedAt: Date.now(),
    blockHeight: 108_713,
    bestBlockHash: HASH_A,
    chainStatus: 'not-comparable',
    ...overrides,
  };
}

describe('seed node baseline classification', () => {
  it('marks both hardcoded seeds as the baseline only when height and hash agree', () => {
    const rows = classifySeedBaseline([
      observation({ ip: '154.12.247.198', label: 'Seed 1' }),
      observation({ ip: '154.12.247.214', label: 'Seed 2' }),
    ]);

    expect(rows.map((row) => row.chainStatus)).toEqual(['seed-baseline', 'seed-baseline']);
    expect(rows.map((row) => row.blocksDelta)).toEqual([0, 0]);
  });

  it('reports seed divergence when the static seeds have different hashes', () => {
    const rows = classifySeedBaseline([
      observation({ ip: '154.12.247.198', label: 'Seed 1' }),
      observation({ ip: '154.12.247.214', label: 'Seed 2', bestBlockHash: HASH_B }),
    ]);

    expect(rows.map((row) => row.chainStatus)).toEqual(['seed-divergence', 'seed-divergence']);
    expect(rows.every((row) => row.blocksDelta === undefined)).toBe(true);
  });

  it('treats seeds one block apart as propagation lag, not divergence', () => {
    // Seed responses are sampled independently, so a new block can land between them.
    // The regression this guards: differing heights used to break the
    // height:hash grouping and flag BOTH seeds as diverged.
    const rows = classifySeedBaseline([
      observation({ ip: '154.12.247.198', label: 'Seed 1', blockHeight: 126_414, bestBlockHash: HASH_A }),
      observation({ ip: '154.12.247.214', label: 'Seed 2', blockHeight: 126_415, bestBlockHash: HASH_B }),
    ]);

    expect(rows.map((row) => row.chainStatus)).toEqual(['behind', 'seed-baseline']);
    expect(rows.map((row) => row.blocksDelta)).toEqual([-1, 0]);
  });

  it('reports divergence when the seeds are further apart than the lag tolerance', () => {
    const rows = classifySeedBaseline([
      observation({ ip: '154.12.247.198', label: 'Seed 1', blockHeight: 126_400, bestBlockHash: HASH_A }),
      observation({ ip: '154.12.247.214', label: 'Seed 2', blockHeight: 126_415, bestBlockHash: HASH_B }),
    ]);

    expect(rows.map((row) => row.chainStatus)).toEqual(['seed-divergence', 'seed-divergence']);
  });

  it('does not manufacture a baseline when a seed is unavailable', () => {
    const rows = classifySeedBaseline([
      observation({ ip: '154.12.247.198', label: 'Seed 1' }),
      observation({ ip: '154.12.247.214', label: 'Seed 2', reachable: false, bestBlockHash: undefined }),
    ]);

    expect(rows.map((row) => row.chainStatus)).toEqual(['not-comparable', 'not-comparable']);
  });

  describe('with the three v23 hardcoded seeds', () => {
    const SEED_1 = { ip: '154.12.247.198', label: 'Seed 1' };
    const SEED_2 = { ip: '154.12.247.214', label: 'Seed 2' };
    const SEED_3 = { ip: '154.26.155.66', label: 'Seed 3' };

    it('agrees on a baseline when all three report the same tip', () => {
      const rows = classifySeedBaseline([observation(SEED_1), observation(SEED_2), observation(SEED_3)]);

      expect(rows.map((row) => row.chainStatus)).toEqual(['seed-baseline', 'seed-baseline', 'seed-baseline']);
      expect(rows.map((row) => row.blocksDelta)).toEqual([0, 0, 0]);
    });

    it('keeps the baseline when one seed is a block behind the other two', () => {
      const rows = classifySeedBaseline([
        observation({ ...SEED_1, blockHeight: 140_490, bestBlockHash: HASH_B }),
        observation({ ...SEED_2, blockHeight: 140_490, bestBlockHash: HASH_B }),
        observation({ ...SEED_3, blockHeight: 140_489, bestBlockHash: HASH_A }),
      ]);

      expect(rows.map((row) => row.chainStatus)).toEqual(['seed-baseline', 'seed-baseline', 'behind']);
      expect(rows[2].blocksDelta).toBe(-1);
    });

    it('reports divergence when one of three disagrees on the hash at the same height', () => {
      const rows = classifySeedBaseline([
        observation(SEED_1),
        observation(SEED_2),
        observation({ ...SEED_3, bestBlockHash: HASH_B }),
      ]);

      expect(rows.every((row) => row.chainStatus === 'seed-divergence')).toBe(true);
    });

    it('does not manufacture a baseline from two seeds when the third is unavailable', () => {
      const rows = classifySeedBaseline([
        observation(SEED_1),
        observation(SEED_2),
        observation({ ...SEED_3, reachable: false, blockHeight: undefined, bestBlockHash: undefined }),
      ]);

      expect(rows.every((row) => row.chainStatus === 'not-comparable')).toBe(true);
    });
  });
});
