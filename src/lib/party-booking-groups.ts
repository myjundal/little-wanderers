type PartyBooking = {
  status: 'pending' | 'confirmed' | 'cancelled' | 'early_access_hold';
  end_time: string;
  notes: string | null;
};

export function hasPartyCancellationRequest(item: Pick<PartyBooking, 'notes' | 'status'>) {
  return item.status !== 'cancelled' && (item.notes ?? '').includes('[Cancellation requested');
}

export function isCompletedParty(item: PartyBooking, now: number) {
  return (item.status === 'confirmed' || item.status === 'early_access_hold')
    && !hasPartyCancellationRequest(item)
    && Date.parse(item.end_time) <= now;
}

/** Completion is a view of ended bookings; keep the booking and attendance history intact. */
export function groupPartyBookings<T extends PartyBooking>(items: T[], now: number) {
  const groups = {
    requests: [] as T[], confirmed: [] as T[], cancellationRequests: [] as T[],
    completed: [] as T[], cancelled: [] as T[],
  };
  for (const item of items) {
    if (item.status === 'cancelled') groups.cancelled.push(item);
    else if (hasPartyCancellationRequest(item)) groups.cancellationRequests.push(item);
    else if (isCompletedParty(item, now)) groups.completed.push(item);
    else if (item.status === 'pending') groups.requests.push(item);
    else groups.confirmed.push(item);
  }
  groups.completed.sort((a, b) => Date.parse(b.end_time) - Date.parse(a.end_time));
  return groups;
}
