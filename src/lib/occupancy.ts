import type { SupabaseClient } from '@supabase/supabase-js';

export type CrowdLevel = 'light' | 'moderate' | 'busy' | 'near_capacity';

const FIXED_OCCUPANCY_CAPACITY = 80;

const OCCUPANCY_KEYS = ['current_occupancy', 'occupancy', 'current_headcount', 'headcount', 'guest_count'];
const LEVEL_KEYS = ['crowd_level', 'occupancy_level', 'level'];
const UPDATED_AT_KEYS = ['updated_at', 'last_updated_at', 'calculated_at'];
const DATE_KEYS = ['effective_date', 'business_date', 'date'];

type OccupancyStatusRow = Record<string, unknown>;

export function getOccupancyCapacity() {
  return FIXED_OCCUPANCY_CAPACITY;
}

function readNumber(row: OccupancyStatusRow | null, keys: string[], fallback: number) {
  for (const key of keys) {
    const value = row?.[key];
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readString(row: OccupancyStatusRow | null, keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function normalizeCrowdLevel(level: string | null, occupancy: number, capacity: number): CrowdLevel {
  const normalized = level?.trim().toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_') ?? '';
  if (normalized === 'light') return 'light';
  if (normalized === 'moderate') return 'moderate';
  if (normalized === 'busy') return 'busy';
  if (normalized === 'near_capacity' || normalized === 'nearcapacity') return 'near_capacity';

  const ratio = capacity > 0 ? Math.max(occupancy, 0) / capacity : 0;
  if (ratio >= 0.8) return 'near_capacity';
  if (ratio >= 0.5) return 'busy';
  if (ratio >= 0.25) return 'moderate';
  return 'light';
}

export function getCrowdLevelMeta(level: CrowdLevel) {
  switch (level) {
    case 'light':
      return {
        label: 'Light',
        accent: '#eadcff',
        accentStrong: '#c8a5ff',
        description: 'A softer, more open moment in the studio right now.',
      };
    case 'moderate':
      return {
        label: 'Moderate',
        accent: '#dfc9ff',
        accentStrong: '#aa7cf4',
        description: 'A steady flow of families with room to settle in.',
      };
    case 'busy':
      return {
        label: 'Busy',
        accent: '#ceb0ff',
        accentStrong: '#8751df',
        description: 'A lively stretch with a fuller feel than usual.',
      };
    case 'near_capacity':
      return {
        label: 'Near Capacity',
        accent: '#b184ff',
        accentStrong: '#5c29b2',
        description: 'One of our fuller moments today, with limited extra room.',
      };
  }
}

export async function getOccupancyStatus(admin: SupabaseClient) {
  const { data, error } = await admin.from('occupancy_status').select('*').limit(1).maybeSingle();
  if (error) throw new Error(error.message);

  const row = (data ?? null) as OccupancyStatusRow | null;
  const occupancy = Math.max(readNumber(row, OCCUPANCY_KEYS, 0), 0);
  const capacity = getOccupancyCapacity();
  const crowdLevel = normalizeCrowdLevel(readString(row, LEVEL_KEYS), occupancy, capacity);
  const crowdMeta = getCrowdLevelMeta(crowdLevel);

  return {
    occupancy,
    capacity,
    progress: Math.min(occupancy / capacity, 1),
    crowdLevel,
    crowdMeta,
    effectiveDate: readString(row, DATE_KEYS) ?? new Date().toISOString().slice(0, 10),
    lastUpdatedAt: readString(row, UPDATED_AT_KEYS),
    source: row,
  };
}

const RPC_VARIANTS: Record<string, Array<(amount?: number) => Record<string, unknown>>> = {
  record_checkin: [
    (amount = 1) => ({ p_group_size: amount }),
    (amount = 1) => ({ group_size: amount }),
    (amount = 1) => ({ p_amount: amount }),
    (amount = 1) => ({ amount }),
    () => ({}),
  ],
  record_manual_increment: [
    (amount = 1) => ({ p_amount: amount }),
    (amount = 1) => ({ amount }),
    (amount = 1) => ({ increment_by: amount }),
    (amount = 1) => ({ p_increment_by: amount }),
  ],
  record_manual_decrement: [
    (amount = 1) => ({ p_amount: amount }),
    (amount = 1) => ({ amount }),
    (amount = 1) => ({ decrement_by: amount }),
    (amount = 1) => ({ p_decrement_by: amount }),
  ],
  reset_occupancy: [
    () => ({}),
    () => ({ p_confirm: true }),
  ],
};

function isSignatureError(message: string) {
  return /Could not find the function|No function matches|PGRST202|PGRST203|schema cache/i.test(message);
}

export async function callOccupancyRpc(admin: SupabaseClient, rpcName: 'record_checkin' | 'record_manual_increment' | 'record_manual_decrement' | 'reset_occupancy', amount?: number) {
  const variants = RPC_VARIANTS[rpcName] ?? [() => ({})];
  let lastError: Error | null = null;

  for (const buildArgs of variants) {
    const payload = buildArgs(amount);
    const { error } = await admin.rpc(rpcName, payload);
    if (!error) return;

    lastError = new Error(error.message);
    if (!isSignatureError(error.message)) {
      throw lastError;
    }
  }

  throw lastError ?? new Error(`Failed to call ${rpcName}`);
}
