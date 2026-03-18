import type { SupabaseClient } from '@supabase/supabase-js';

export type CrowdLevel = 'light' | 'moderate' | 'busy' | 'near_capacity';
export type OccupancyEventType = 'checkin_increment' | 'manual_increment' | 'manual_decrement' | 'reset';

export type OccupancyEventRecord = {
  id: string;
  event_type: OccupancyEventType;
  delta: number;
  effective_date: string;
  created_at: string;
  notes: string | null;
  metadata?: Record<string, unknown> | null;
};

export const DEFAULT_OCCUPANCY_CAPACITY = 24;

export function getOccupancyCapacity() {
  const raw = Number(process.env.OCCUPANCY_CAPACITY ?? process.env.NEXT_PUBLIC_OCCUPANCY_CAPACITY ?? DEFAULT_OCCUPANCY_CAPACITY);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_OCCUPANCY_CAPACITY;
}

export function getCrowdLevel(occupancy: number, capacity = getOccupancyCapacity()): CrowdLevel {
  const safeOccupancy = Math.max(occupancy, 0);
  const ratio = capacity > 0 ? safeOccupancy / capacity : 0;

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

export function computeOccupancyFromEvents(events: Pick<OccupancyEventRecord, 'delta'>[]) {
  return events.reduce((running, event) => Math.max(running + Number(event.delta ?? 0), 0), 0);
}

export async function getOccupancySummary(admin: SupabaseClient) {
  const effectiveDate = new Date().toISOString().slice(0, 10);

  const { data, error } = await admin
    .from('occupancy_events')
    .select('id,event_type,delta,effective_date,created_at,notes,metadata')
    .eq('effective_date', effectiveDate)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const events = (data ?? []) as OccupancyEventRecord[];
  const occupancy = computeOccupancyFromEvents(events);
  const capacity = getOccupancyCapacity();
  const crowdLevel = getCrowdLevel(occupancy, capacity);
  const crowdMeta = getCrowdLevelMeta(crowdLevel);

  return {
    effectiveDate,
    occupancy,
    capacity,
    progress: Math.min(occupancy / capacity, 1),
    crowdLevel,
    crowdMeta,
    events,
    lastUpdatedAt: events.at(-1)?.created_at ?? null,
  };
}
