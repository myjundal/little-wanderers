export type WaitlistDisplayCount = {
  displayCount: number;
};

// Wanderlist closed on October 28, 2026. Verified 466 entries before the
// cutoff on November 4; keep the public total stable until the card is retired.
const CLOSED_WANDERLIST_COUNT = 466;

export async function getWaitlistCount(): Promise<WaitlistDisplayCount> {
  return { displayCount: Math.floor(CLOSED_WANDERLIST_COUNT / 10) * 10 };
}
