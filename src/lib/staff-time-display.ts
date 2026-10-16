export const staffTimeLabel = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) : 'Still clocked in';
export function closedShiftHours(start: string, end: string | null) {
  if (!end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms / 3_600_000 : null;
}
