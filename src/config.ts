import type { Config } from './engine/types';

/**
 * Game rules that may change live here, not in code (NFR-5).
 * AH values are PLACEHOLDERS based on Classic and must be verified in WoW Forever.
 * Everything here is editable in Settings and stored in the database.
 */
export const DEFAULT_CONFIG: Config = {
  ahCut: { faction: 0.05, neutral: 0.15 },
  durations: [
    { key: '2h', label: '2 hours', depositRate: { faction: 0.05, neutral: 0.25 } },
    { key: '8h', label: '8 hours', depositRate: { faction: 0.15, neutral: 0.75 } },
    { key: '24h', label: '24 hours', depositRate: { faction: 0.3, neutral: 1.5 } },
  ],
  minDeposit: 1,
  perActionOverheadSec: 1,
  perBatchOverheadSec: 120,
  defaultBatchSize: 20,
  simulationRuns: 5000,
  disenchantCastMs: 3000,
};

/** Merge a stored (possibly older) config over the defaults so new keys get defaults. */
export function withDefaults(stored: Partial<Config> | null | undefined): Config {
  return { ...DEFAULT_CONFIG, ...(stored ?? {}) };
}
