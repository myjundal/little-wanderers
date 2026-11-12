export type RosterRegistration = {
  id: string;
  personId: string;
  name: string;
  status: string;
  age?: number | null;
  attendanceStatus?: string;
  householdId?: string | null;
};

export type RosterSession = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  scheduleLabel?: string | null;
  instructorNote?: string | null;
  registrations: RosterRegistration[];
};

export type RegistrationGroup = 'confirmed' | 'interested';
export type WeeklyRosterSession = Omit<RosterSession, 'registrations'> & {
  confirmed: RosterRegistration[];
  interested: RosterRegistration[];
};
export type RosterDay = { date: string; sessions: WeeklyRosterSession[] };

export function classRegistrationGroup(status: string): RegistrationGroup | null {
  if (status === 'scheduled' || status === 'attended') return 'confirmed';
  if (['preregistered', 'waitlist', 'waitlisted'].includes(status)) return 'interested';
  return null;
}

// Calendar keys use the venue's timezone, even on staff devices in other zones.
export function classRosterDate(value: string | number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export function shiftRosterDate(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function classRosterWeekStart(date = classRosterDate()): string {
  return shiftRosterDate(date, -new Date(`${date}T12:00:00Z`).getUTCDay());
}

export function groupWeeklyClassRosters(sessions: RosterSession[], weekStart: string): RosterDay[] {
  const weekEnd = shiftRosterDate(weekStart, 7);
  const grouped = new Map<string, WeeklyRosterSession>();
  for (const session of sessions) {
    if (session.status === 'cancelled' || !Number.isFinite(Date.parse(session.startTime))) continue;
    const date = classRosterDate(session.startTime);
    if (date < weekStart || date >= weekEnd) continue;
    const existing = grouped.get(session.id);
    const registrations = new Map<string, RosterRegistration>();
    for (const reg of [...(existing?.interested ?? []), ...(existing?.confirmed ?? []), ...session.registrations]) {
      const group = classRegistrationGroup(reg.status);
      if (!group) continue;
      const key = reg.personId || reg.id;
      // Duplicate rows must never count the same child as both interested and confirmed.
      if (classRegistrationGroup(registrations.get(key)?.status ?? '') !== 'confirmed') registrations.set(key, reg);
    }
    const sorted = [...registrations.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    grouped.set(session.id, {
      ...session,
      confirmed: sorted.filter(reg => classRegistrationGroup(reg.status) === 'confirmed'),
      interested: sorted.filter(reg => classRegistrationGroup(reg.status) === 'interested'),
    });
  }
  const days = new Map<string, WeeklyRosterSession[]>();
  for (const session of [...grouped.values()].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))) {
    const date = classRosterDate(session.startTime);
    const list = days.get(date) ?? [];
    list.push(session);
    days.set(date, list);
  }
  return [...days].map(([date, sessions]) => ({ date, sessions }));
}

export function filterWeeklyClassRosters(days: RosterDay[], search: string, classTitle = ''): RosterDay[] {
  const query = search.trim().toLowerCase();
  return days.flatMap(day => {
    const sessions = day.sessions.filter(session => !classTitle || session.title === classTitle).flatMap(session => {
      if (!query || session.title.toLowerCase().includes(query)) return [session];
      const confirmed = session.confirmed.filter(reg => reg.name.toLowerCase().includes(query));
      const interested = session.interested.filter(reg => reg.name.toLowerCase().includes(query));
      return confirmed.length || interested.length ? [{ ...session, confirmed, interested }] : [];
    });
    return sessions.length ? [{ ...day, sessions }] : [];
  });
}
