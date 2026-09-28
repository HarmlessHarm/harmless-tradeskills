import type { Copper } from './types';

export const SILVER = 100;
export const GOLD = 10_000;

export interface MoneyParts {
  negative: boolean;
  gold: number;
  silver: number;
  copper: number;
}

export function splitMoney(value: Copper): MoneyParts {
  const negative = value < 0;
  const abs = Math.round(Math.abs(value));
  return {
    negative,
    gold: Math.floor(abs / GOLD),
    silver: Math.floor((abs % GOLD) / SILVER),
    copper: abs % SILVER,
  };
}

/** "1g 2s 3c", omitting zero units ("1g", "2s 5c", "0c"). Fractional copper is rounded. */
export function formatMoney(value: Copper | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  const { negative, gold, silver, copper } = splitMoney(value);
  const parts: string[] = [];
  if (gold) parts.push(`${gold}g`);
  if (silver) parts.push(`${silver}s`);
  if (copper || parts.length === 0) parts.push(`${copper}c`);
  return (negative ? '-' : '') + parts.join(' ');
}

/**
 * Parse money typed by a human. Accepts "1g 2s 3c", "1g2s", "25s", "-3s 5c".
 * A bare integer is copper. Returns null for empty or invalid input.
 */
export function parseMoney(input: string): Copper | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return null;
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  if (/^\d+$/.test(body)) return (negative ? -1 : 1) * Number(body);
  const match = /^(?:(\d+)g)?(?:(\d+)s)?(?:(\d+)c)?$/.exec(body);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const total = Number(match[1] ?? 0) * GOLD + Number(match[2] ?? 0) * SILVER + Number(match[3] ?? 0);
  return negative ? -total : total;
}
