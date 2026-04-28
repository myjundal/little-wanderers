export const WAIVER_VALIDITY_DAYS = 90;

export type WaiverStatus = 'completed' | 'required' | 'expired';

export type WaiverRow = {
  signed_at?: string | null;
  signed_date?: string | null;
  waiver_expires_at?: string | null;
  created_at?: string | null;
};

export type WaiverStatusDetails = {
  status: WaiverStatus;
  signedAt: string | null;
  expiresAt: string | null;
  daysUntilExpiration: number | null;
};

function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function getWaiverStatus(rows: WaiverRow[], now = new Date()): WaiverStatusDetails {
  const latest = [...rows]
    .map((row) => {
      const signedAt = toDate(row.signed_at) ?? toDate(row.signed_date);
      const createdAt = toDate(row.created_at);
      return { row, signedAt, createdAt };
    })
    .sort((a, b) => {
      const left = a.signedAt?.getTime() ?? a.createdAt?.getTime() ?? 0;
      const right = b.signedAt?.getTime() ?? b.createdAt?.getTime() ?? 0;
      return right - left;
    })[0];

  const signedAt = latest?.signedAt ?? null;
  if (!signedAt) {
    return { status: 'required', signedAt: null, expiresAt: null, daysUntilExpiration: null };
  }

  const expiresAt = toDate(latest?.row.waiver_expires_at) ?? addDays(signedAt, WAIVER_VALIDITY_DAYS);
  const nowDay = startOfUtcDay(now);
  const expiresDay = startOfUtcDay(expiresAt);
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntilExpiration = Math.floor((expiresDay.getTime() - nowDay.getTime()) / msPerDay);

  return {
    status: daysUntilExpiration >= 0 ? 'completed' : 'expired',
    signedAt: signedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    daysUntilExpiration,
  };
}

export function getWaiverStatusLabel(status: WaiverStatus): string {
  if (status === 'completed') return 'Waiver completed';
  if (status === 'expired') return 'Waiver expired / renewal needed';
  return 'Waiver required';
}
