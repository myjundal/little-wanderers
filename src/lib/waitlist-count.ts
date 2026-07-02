export const WAITLIST_COUNT_FALLBACK = 360;

export type WaitlistDisplayCount = {
  displayCount: number;
};

type WaitlistCount = WaitlistDisplayCount & {
  actualCount: number;
};

function asNonNegativeInteger(value: unknown) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

export function toWaitlistCount(value: unknown): WaitlistCount | null {
  const actualCount = asNonNegativeInteger(value);

  if (actualCount === null) return null;

  return {
    actualCount,
    displayCount: Math.floor(actualCount / 10) * 10,
  };
}

function fallbackWaitlistCount() {
  return (
    toWaitlistCount(process.env.WAITLIST_COUNT_FALLBACK) ??
    toWaitlistCount(WAITLIST_COUNT_FALLBACK)!
  );
}

export async function getWaitlistCount(): Promise<WaitlistCount> {
  const fallback = fallbackWaitlistCount();
  const endpoint = process.env.WAITLIST_COUNT_ENDPOINT?.trim();

  if (!endpoint) return fallback;

  try {
    const response = await fetch(endpoint, {
      headers: { accept: 'application/json' },
      next: { revalidate: 60 },
    });

    if (!response.ok) return fallback;

    const payload = (await response.json()) as { count?: unknown };
    return toWaitlistCount(payload.count) ?? fallback;
  } catch {
    return fallback;
  }
}
