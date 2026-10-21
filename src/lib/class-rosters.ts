export type RosterRegistration = {
  id: string;
  personId: string;
  name: string;
  status: string;
  age?: number | null;
  householdId?: string | null;
};

export type RosterSession = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  scheduleLabel?: string | null;
  registrations: RosterRegistration[];
};

export type RosterChild = Omit<RosterRegistration, 'id' | 'status'> & {
  dates: Array<{ sessionId: string; startTime: string }>;
};

export type ClassRoster = {
  key: string;
  title: string;
  scheduleLabels: string[];
  sessionCount: number;
  children: RosterChild[];
};

const ACTIVE_STATUSES = new Set(['preregistered', 'scheduled', 'attended', 'waitlist', 'waitlisted']);

export function groupClassRosters(sessions: RosterSession[], scope: 'upcoming' | 'all' = 'all', now = Date.now()): ClassRoster[] {
  const groups = new Map<string, { roster: ClassRoster; children: Map<string, RosterChild>; sessionIds: Set<string> }>();
  for (const session of sessions) {
    const start = new Date(session.startTime).getTime();
    const end = new Date(session.endTime).getTime();
    if (session.status === 'cancelled' || !Number.isFinite(start)) continue;
    if (scope === 'upcoming' && (Number.isFinite(end) ? end : start) <= now) continue;
    const key = session.title.trim() || session.id;
    let group = groups.get(key);
    if (!group) {
      group = { roster: { key, title: session.title, scheduleLabels: [], sessionCount: 0, children: [] }, children: new Map(), sessionIds: new Set() };
      groups.set(key, group);
    }
    group.sessionIds.add(session.id);
    if (session.scheduleLabel && !group.roster.scheduleLabels.includes(session.scheduleLabel)) group.roster.scheduleLabels.push(session.scheduleLabel);
    for (const registration of session.registrations) {
      if (!ACTIVE_STATUSES.has(registration.status)) continue;
      const personId = registration.personId || registration.id;
      let child = group.children.get(personId);
      if (!child) {
        child = { personId, name: registration.name, age: registration.age, householdId: registration.householdId, dates: [] };
        group.children.set(personId, child);
      }
      if (!child.dates.some(date => date.sessionId === session.id)) child.dates.push({ sessionId: session.id, startTime: session.startTime });
    }
  }
  return [...groups.values()].map(({ roster, children, sessionIds }) => ({
    ...roster,
    sessionCount: sessionIds.size,
    children: [...children.values()].map(child => ({ ...child, dates: child.dates.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.personId.localeCompare(b.personId)),
  })).sort((a, b) => a.title.localeCompare(b.title));
}

export function filterClassRosters(rosters: ClassRoster[], search: string, classKey = ''): ClassRoster[] {
  const query = search.trim().toLowerCase();
  return rosters.filter(roster => !classKey || roster.key === classKey).flatMap(roster => {
    if (!query || roster.title.toLowerCase().includes(query)) return [roster];
    const children = roster.children.filter(child => child.name.toLowerCase().includes(query));
    return children.length ? [{ ...roster, children }] : [];
  });
}
