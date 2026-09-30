'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import ActionToast from '@/components/ui/ActionToast';

type Person = {
  id: string;
  first_name: string;
  last_name: string | null;
  birthdate: string | null;
};

type ClassItem = {
  id: string;
  title: string;
  category: string | null;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
  instructor_name: string | null;
  description: string | null;
  age_range: string | null;
  caregiver_participation: string | null;
  schedule_note: string | null;
  schedule_label: string | null;
  capacity: number | null;
  price_cents: number;
  booked_count: number;
  seats_left: number | null;
  waitlist_offer_pending?: boolean;
  waitlist_count?: number;
  is_popular: boolean;
  recommended_class_ids: string[];
};

type ClassSeries = ClassItem & {
  occurrences: ClassItem[];
};

type FamilyProfileResponse = {
  ok?: boolean;
  guardian?: { first_name: string | null; last_name: string | null } | null;
  children?: Person[];
  error?: string;
};

type RegistrationItem = {
  id: string;
  person_id: string;
  status: 'scheduled' | 'cancelled' | 'waitlist' | 'attended';
  attendance_status: 'unknown' | 'attended' | 'cancelled' | 'no_show';
  attendance_display_status: 'attended' | 'cancelled' | 'not_attended' | 'upcoming' | 'waitlist';
  attendance_marked_at: string | null;
  person_name: string;
  created_at: string;
  customer_favorite: boolean;
  customer_note: string | null;
  customer_note_updated_at: string | null;
  class: {
    id: string;
    title: string;
    start_time: string;
    end_time: string;
    category: string | null;
    status: string;
  } | null;
};

const historyTabButtonStyle: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid #d9c8f7',
  padding: '9px 14px',
  fontWeight: 700,
  color: '#5f3da4',
  background: '#fff',
};

const historyTabButtonActiveStyle: React.CSSProperties = {
  ...historyTabButtonStyle,
  background: '#f3ebff',
  border: '1px solid #b897ec',
  boxShadow: '0 2px 8px rgba(95,61,164,0.12)',
};

const ADDITIONAL_CHILD_VALUE = '__add_child__';
const WEEKDAY_COLUMNS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
];

function classSeriesKey(item: ClassItem) {
  return [
    item.title,
    item.category ?? '',
    item.schedule_label ?? '',
    item.duration_minutes ?? '',
    item.capacity ?? '',
    item.price_cents,
  ].join('::');
}

function firstText(occurrences: ClassItem[], key: keyof Pick<ClassItem, 'category' | 'instructor_name' | 'description' | 'age_range' | 'caregiver_participation' | 'schedule_note' | 'schedule_label'>) {
  return occurrences.find((item) => item[key])?.[key] ?? null;
}

function classSeriesBase(occurrences: ClassItem[]) {
  const sorted = [...occurrences].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  const base = sorted[0];
  return {
    ...base,
    category: firstText(sorted, 'category'),
    instructor_name: firstText(sorted, 'instructor_name'),
    description: firstText(sorted, 'description'),
    age_range: firstText(sorted, 'age_range'),
    caregiver_participation: firstText(sorted, 'caregiver_participation'),
    schedule_note: firstText(sorted, 'schedule_note'),
    schedule_label: firstText(sorted, 'schedule_label'),
    duration_minutes: sorted.find((item) => item.duration_minutes)?.duration_minutes ?? base.duration_minutes,
    is_popular: sorted.some((item) => item.is_popular),
  };
}

function groupClassSeries(items: ClassItem[]) {
  const groups = new Map<string, ClassItem[]>();
  items.forEach((item) => {
    const key = classSeriesKey(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  });

  return Array.from(groups.values()).map((occurrences) => {
    const sorted = [...occurrences].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    return { ...classSeriesBase(sorted), occurrences: sorted } satisfies ClassSeries;
  });
}

function classDateLabel(item: ClassItem) {
  const start = new Date(item.start_time);
  const end = new Date(item.end_time);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Date TBA';
  const date = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const startTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const endTime = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `${date} · ${startTime}-${endTime}`;
}

function classScheduleLabel(item: ClassItem) {
  if (item.schedule_note && item.schedule_label) return `${item.schedule_note} · ${item.schedule_label}`;
  return item.schedule_note ?? item.schedule_label ?? classDateLabel(item);
}

function seatsLine(item: ClassItem) {
  if (item.capacity == null) return 'Seats: Unlimited';
  if (item.waitlist_offer_pending) return `Seats: ${item.booked_count}/${item.capacity} (waitlist offer pending)`;
  if ((item.waitlist_count ?? 0) > 0) return `Seats: ${item.booked_count}/${item.capacity} (waitlist: ${item.waitlist_count})`;
  return `Seats: ${item.booked_count}/${item.capacity} (left: ${item.seats_left ?? 0})`;
}

function compactSeatsLine(item: ClassItem) {
  if (item.capacity == null) return 'Unlimited seats';
  if (item.waitlist_offer_pending || (item.waitlist_count ?? 0) > 0) return 'Waitlist open';
  const seatsLeft = item.seats_left ?? Math.max(item.capacity - item.booked_count, 0);
  if (seatsLeft <= 0) return 'Waitlist';
  return `${seatsLeft}/${item.capacity} seats left`;
}

function compactCaregiverLabel(value: string | null) {
  if (!value) return 'Participation TBA';
  if (value.toLowerCase().includes('drop')) return 'Drop-off';
  return value;
}

function timeOnlyLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Time TBA';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

function weekdayTimeLabel(item: ClassItem) {
  const date = new Date(item.start_time);
  if (Number.isNaN(date.getTime())) return timeOnlyLabel(item.start_time);
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  return `${weekday} ${timeOnlyLabel(item.start_time)}`;
}

function classCardDomId(series: ClassSeries) {
  return `class-card-${series.id}`;
}

export default function ClassSchedulePage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [myItems, setMyItems] = useState<RegistrationItem[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [quickChildName, setQuickChildName] = useState('');
  const [quickChildAge, setQuickChildAge] = useState('');
  const [guardianFirstName, setGuardianFirstName] = useState('');
  const [guardianLastName, setGuardianLastName] = useState('');
  const [creatingChild, setCreatingChild] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'warning' | 'error' } | null>(null);
  const [registeringClassId, setRegisteringClassId] = useState<string | null>(null);
  const [claimingWaitlist, setClaimingWaitlist] = useState(false);
  const claimingWaitlistTokenRef = useRef<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [savingClassMemoId, setSavingClassMemoId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [historyTab, setHistoryTab] = useState<'upcoming' | 'waitlist' | 'past' | 'cancelled' | 'favorites'>('upcoming');
  const [historyPersonFilter, setHistoryPersonFilter] = useState<string>('all');
  const [activeClassId, setActiveClassId] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setMessage(null);
    }
    const requestKey = Date.now();

    const [classRes, myRes, profileRes] = await Promise.all([
      fetch(`/api/classes?limit=200&ts=${requestKey}`, { cache: 'no-store' }),
      fetch(`/api/classes/my?ts=${requestKey}`, { cache: 'no-store' }),
      fetch(`/api/family/profile?ts=${requestKey}`, { cache: 'no-store' }),
    ]);

    const classJson = await classRes.json();
    const myJson = await myRes.json();
    const profileJson = (await profileRes.json().catch(() => null)) as FamilyProfileResponse | null;

    if (!classRes.ok || !classJson.ok) {
      setMessage(classJson.error ?? 'Failed to load classes.');
      setLoading(false);
      return;
    }

    if (!myRes.ok || !myJson.ok) {
      if (myRes.status === 401) {
        setMyItems([]);
      } else {
        setMessage(myJson.error ?? 'Failed to load my classes.');
        setLoading(false);
        return;
      }
    }

    const loadedClasses = (classJson.items ?? []) as ClassItem[];
    setClasses(loadedClasses);
    setMyItems(myJson.items ?? []);

    const authenticated = profileRes.ok && profileJson?.ok;
    setIsAuthenticated(Boolean(authenticated));
    if (!authenticated) {
      setPeople([]);
      setSelectedPersonId('');
      setLoading(false);
      return;
    }

    if (profileJson?.guardian) {
      setGuardianFirstName((prev) => prev || profileJson.guardian?.first_name || '');
      setGuardianLastName((prev) => prev || profileJson.guardian?.last_name || '');
    }

    const casted = (profileJson?.children ?? []) as Person[];
    setPeople(casted);
    if (casted[0]?.id) setSelectedPersonId((prev) => prev || casted[0].id);

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => {
      load(false);
    }, 30000);

    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const waitlistToken = params.get('waitlist_token');
    if (!waitlistToken || claimingWaitlist || claimingWaitlistTokenRef.current === waitlistToken) return;

    const claim = async () => {
      claimingWaitlistTokenRef.current = waitlistToken;
      const supabase = createBrowserSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        sessionStorage.setItem('post_login_redirect', `/landing/classschedule?waitlist_token=${encodeURIComponent(waitlistToken)}`);
        window.location.assign('/login');
        return;
      }

      setClaimingWaitlist(true);
      setMessage(null);
      const res = await fetch('/api/classes/waitlist/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: waitlistToken }),
      });
      const json = await res.json();
      window.history.replaceState({}, '', '/landing/classschedule');
      if (!res.ok || !json.ok) {
        const quietAlreadyHandled =
          json.error === 'waitlist offer not found' ||
          json.error === 'waitlist offer is no longer available';
        if (!quietAlreadyHandled) {
          setMessage(json.error ?? 'Could not claim waitlist spot.');
        }
        setClaimingWaitlist(false);
        return;
      }

      const childName = typeof json.person_name === 'string' && json.person_name.trim() ? json.person_name.trim() : 'Your child';
      setMessage(null);
      setToast({ message: `${childName} automatically registered.`, tone: 'success' });
      setClaimingWaitlist(false);
      await load(false);
    };

    void claim();
  }, [claimingWaitlist, load]);

  const registrationStatusByClassAndPerson = useMemo(
    () =>
      new Map(
        myItems
          .filter((item) => item.status !== 'cancelled' && item.class?.status !== 'cancelled' && item.class?.id)
          .map((item) => [`${item.class!.id}:${item.person_id}`, item.status])
      ),
    [myItems]
  );

  const classSeries = useMemo(() => groupClassSeries(classes), [classes]);
  const activeSeriesKey = useMemo(() => {
    if (!activeClassId) return null;
    const item = classes.find((klass) => klass.id === activeClassId);
    return item ? classSeriesKey(item) : null;
  }, [activeClassId, classes]);
  const sortedClassSeries = useMemo(() => {
    if (!activeSeriesKey) return classSeries;
    return [...classSeries].sort((a, b) => {
      const aActive = classSeriesKey(a) === activeSeriesKey;
      const bActive = classSeriesKey(b) === activeSeriesKey;
      if (aActive === bActive) return 0;
      return aActive ? -1 : 1;
    });
  }, [activeSeriesKey, classSeries]);
  const weeklySchedule = useMemo(() => {
    const grouped = new Map<number, ClassItem[]>();
    WEEKDAY_COLUMNS.forEach((day) => grouped.set(day.value, []));
    classes.forEach((item) => {
      const day = new Date(item.start_time).getDay();
      if (!grouped.has(day)) return;
      grouped.get(day)!.push(item);
    });
    grouped.forEach((items, day) => {
      grouped.set(day, [...items].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()));
    });
    return grouped;
  }, [classes]);

  useEffect(() => {
    if (activeClassId && !classes.some((item) => item.id === activeClassId)) {
      setActiveClassId(null);
    }
  }, [activeClassId, classes]);

  useEffect(() => {
    setNoteDrafts((prev) => {
      const next = { ...prev };
      myItems.forEach((item) => {
        if (!(item.id in next)) next[item.id] = item.customer_note ?? '';
      });
      return next;
    });
  }, [myItems]);

  const cancelledItems = useMemo(
    () => myItems.filter((item) => item.status === 'cancelled' || item.class?.status === 'cancelled'),
    [myItems]
  );
  const activeItems = useMemo(
    () => myItems.filter((item) => item.status !== 'cancelled' && item.class?.status !== 'cancelled'),
    [myItems]
  );
  const waitlistItems = useMemo(
    () => activeItems.filter((item) => item.status === 'waitlist' || item.attendance_display_status === 'waitlist'),
    [activeItems]
  );
  const upcomingHistoryItems = useMemo(
    () =>
      activeItems.filter((item) => {
        if (item.status === 'waitlist' || item.attendance_display_status === 'waitlist') return false;
        const startsAt = item.class?.start_time ? new Date(item.class.start_time).getTime() : 0;
        return startsAt > Date.now() || item.attendance_display_status === 'upcoming';
      }),
    [activeItems]
  );
  const pastHistoryItems = useMemo(
    () =>
      activeItems.filter((item) => {
        if (item.status === 'waitlist' || item.attendance_display_status === 'waitlist') return false;
        const startsAt = item.class?.start_time ? new Date(item.class.start_time).getTime() : 0;
        return startsAt <= Date.now() && item.attendance_display_status !== 'upcoming';
      }),
    [activeItems]
  );
  const favoriteItems = useMemo(
    () =>
      activeItems.filter((item) => {
        const attended = item.attendance_status === 'attended' || item.status === 'attended';
        return attended && item.customer_favorite;
      }),
    [activeItems]
  );
  const selectedHistoryItems = useMemo(() => {
    if (historyTab === 'upcoming') return upcomingHistoryItems;
    if (historyTab === 'waitlist') return waitlistItems;
    if (historyTab === 'past') return pastHistoryItems;
    if (historyTab === 'favorites') return favoriteItems;
    return cancelledItems;
  }, [cancelledItems, favoriteItems, historyTab, pastHistoryItems, upcomingHistoryItems, waitlistItems]);
  const visibleHistoryItems = useMemo(
    () => selectedHistoryItems.filter((item) => historyPersonFilter === 'all' || item.person_id === historyPersonFilter),
    [historyPersonFilter, selectedHistoryItems]
  );
  const selectedPerson = useMemo(
    () => people.find((person) => person.id === selectedPersonId) ?? null,
    [people, selectedPersonId]
  );
  const isAddingAdditionalChild = selectedPersonId === ADDITIONAL_CHILD_VALUE;
  const selectedPersonNeedsAge = Boolean(selectedPerson && !selectedPerson.birthdate);

  const parsedQuickAge = () => {
    const age = Number(quickChildAge);
    if (!Number.isFinite(age) || age < 0 || age > 12) return null;
    return Math.round(age * 2) / 2;
  };

  const guardianPayload = () => {
    const firstName = guardianFirstName.trim();
    const lastName = guardianLastName.trim();
    if (!firstName || !lastName) {
      setMessage('Please enter the parent/guardian first and last name.');
      return null;
    }
    return { guardian_first_name: firstName, guardian_last_name: lastName };
  };

  const ensureSelectedChild = async () => {
    if (selectedPersonId && !isAddingAdditionalChild && !selectedPersonNeedsAge) return selectedPersonId;
    const ageYears = parsedQuickAge();
    if (ageYears == null) {
      setMessage('Please enter your child’s age.');
      return null;
    }

    if (selectedPersonId && !isAddingAdditionalChild && selectedPersonNeedsAge) {
      const guardian = guardianPayload();
      if (!guardian) return null;
      setCreatingChild(true);
      const res = await fetch('/api/family/children', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ person_id: selectedPersonId, age_years: ageYears, ...guardian }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; child?: Person; error?: string } | null;
      setCreatingChild(false);

      if (!res.ok || !json?.ok || !json.child?.id) {
        setMessage(json?.error ?? 'Could not save your child’s age yet.');
        return null;
      }

      const updatedChild = json.child as Person;
      setPeople((current) => current.map((person) => person.id === updatedChild.id ? updatedChild : person));
      setQuickChildAge('');
      return selectedPersonId;
    }

    const name = quickChildName.trim();
    if (!name) {
      setMessage('Please enter your child’s name first.');
      return null;
    }
    const guardian = guardianPayload();
    if (!guardian) return null;

    setCreatingChild(true);
    const res = await fetch('/api/family/children', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, age_years: ageYears, ...guardian }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; child?: Person; error?: string } | null;
    setCreatingChild(false);

    if (!res.ok || !json?.ok || !json.child?.id) {
      setMessage(json?.error ?? 'Could not save your child yet.');
      return null;
    }

    setPeople((current) => [...current, json.child as Person]);
    setSelectedPersonId(json.child.id);
    setQuickChildName('');
    setQuickChildAge('');
    return json.child.id;
  };

  const preRegisterClass = async (classId: string) => {
    if (!isAuthenticated) {
      sessionStorage.setItem('post_login_redirect', '/landing/classschedule');
      window.location.assign(`/login?mode=new&next=${encodeURIComponent('/landing/classschedule')}`);
      return;
    }
    const guardian = guardianPayload();
    if (!guardian) return;
    const personId = await ensureSelectedChild();
    if (!personId) {
      return;
    }

    setRegisteringClassId(classId);
    setMessage(null);

    const res = await fetch('/api/classes/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ class_id: classId, person_id: personId, ...guardian }),
    });
    const json = await res.json();
    setRegisteringClassId(null);

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Pre-registration failed.');
      return;
    }

    const emailFailed = json.email && (!json.email.ok || json.email.skipped);
    const emailPending = Boolean(json.email_pending);
    const registeredClass = classes.find((item) => item.id === classId) ?? null;
    const registeredPerson = people.find((person) => person.id === personId) ?? null;
    const optimisticStatus: RegistrationItem['status'] = json.status === 'waitlist' ? 'waitlist' : 'scheduled';
    if (json.id && registeredClass && registeredPerson) {
      const optimisticItem: RegistrationItem = {
        id: json.id,
        person_id: personId,
        status: optimisticStatus,
        attendance_status: 'unknown',
        attendance_display_status: optimisticStatus === 'waitlist' ? 'waitlist' : 'upcoming',
        attendance_marked_at: null,
        person_name: `${registeredPerson.first_name} ${registeredPerson.last_name ?? ''}`.trim(),
        created_at: new Date().toISOString(),
        customer_favorite: false,
        customer_note: null,
        customer_note_updated_at: null,
        class: {
          id: registeredClass.id,
          title: registeredClass.title,
          start_time: registeredClass.start_time,
          end_time: registeredClass.end_time,
          category: registeredClass.category,
          status: 'scheduled',
        },
      };
      setMyItems((current) => [...current.filter((item) => item.id !== json.id), optimisticItem]);
    }
    const doneMessage =
      emailPending
        ? json.status === 'waitlist'
          ? 'Class is full. You are on the waitlist. Confirmation email will arrive shortly.'
          : 'Pre-registration complete. Confirmation email will arrive shortly.'
        : emailFailed
        ? json.status === 'waitlist'
          ? 'Class is full. You are on the waitlist, but we could not send the confirmation email yet.'
          : 'Pre-registration complete, but we could not send the confirmation email yet.'
        : json.status === 'waitlist'
          ? 'Class is full. You are on the waitlist. Confirmation email sent.'
          : 'Pre-registration complete. Confirmation email sent.';
    setMessage(doneMessage);
    setToast({ message: json.status === 'waitlist' ? 'Waitlist joined.' : 'Pre-registration complete.', tone: emailFailed ? 'warning' : 'success' });
    void load(false);
  };

  const cancelRegistration = async (registrationId: string) => {
    setCancellingId(registrationId);
    setMessage(null);

    const res = await fetch('/api/classes/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ registration_id: registrationId }),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Cancellation failed.');
      setCancellingId(null);
      return;
    }

    const cancellationEmailFailed = json.cancellation_email && (!json.cancellation_email.ok || json.cancellation_email.skipped);
    const cancellationEmailPending = Boolean(json.cancellation_email_pending);
    const doneMessage =
      cancellationEmailPending
        ? 'Class booking has been cancelled. Confirmation email will arrive shortly.'
        : cancellationEmailFailed
        ? 'Class booking has been cancelled, but we could not send the cancellation email yet.'
        : 'Class booking has been cancelled. Cancellation email sent.';
    setMessage(doneMessage);
    setToast({ message: 'Class booking cancelled.', tone: cancellationEmailFailed ? 'warning' : 'success' });
    setMyItems((current) => current.map((item) => item.id === registrationId ? { ...item, status: 'cancelled' } : item));
    setCancellingId(null);
    void load(false);
  };

  const saveClassReflection = async (registrationId: string, favorite: boolean, note: string) => {
    setSavingClassMemoId(registrationId);
    const res = await fetch(`/api/classes/my/${registrationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customer_favorite: favorite, customer_note: note || null }),
    });
    const json = await res.json();
    setSavingClassMemoId(null);

    if (!res.ok || !json.ok) {
      setMessage(json.error ?? 'Could not save class note/favorite.');
      return;
    }

    setMessage('Class favorite/note saved.');
    void load(false);
  };

  const selectScheduleClass = (item: ClassItem) => {
    setActiveClassId(item.id);
    const matchingSeries = classSeries.find((series) => series.occurrences.some((occurrence) => occurrence.id === item.id));
    window.setTimeout(() => {
      const target = matchingSeries ? document.getElementById(classCardDomId(matchingSeries)) : null;
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  return (
    <main style={{ padding: 24, maxWidth: 980, margin: '0 auto', background: 'linear-gradient(180deg,#fff,#f7efff)', border: '1px solid #e3d0fb', borderRadius: 28, boxShadow: '0 18px 30px rgba(120,87,177,0.12)' }}>
      <ActionToast message={toast?.message ?? null} tone={toast?.tone} onDone={() => setToast(null)} />
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#4f3f82', marginBottom: 4 }}>Class Pre-registration</h1>
      <p style={{ color: '#6f628d', marginTop: 8 }}>Wanderlist families get first access. Register for available spots or join the waitlist when a class is full.</p>

      {message && <p style={{ marginTop: 12, color: '#5a4a8f' }}>{message}</p>}
      {claimingWaitlist && <p style={{ marginTop: 12, color: '#5a4a8f' }}>Claiming your waitlist spot...</p>}

      <section className="weeklySchedule" aria-label="Weekly class schedule">
        <div className="weeklyScheduleHeader">
          <div>
            <h2 style={{ fontSize: 22, margin: 0, color: '#4f3f82' }}>Weekly class snapshot</h2>
            <p style={{ margin: '6px 0 0', color: '#6f628d', fontSize: 14 }}>
              Tap a class time to bring its card and pre-registration button to the top.
            </p>
          </div>
        </div>
        {loading ? (
          <p style={{ margin: '12px 0 0', color: '#6f628d' }}>Loading schedule…</p>
        ) : classes.length === 0 ? (
          <p style={{ margin: '12px 0 0', color: '#6f628d' }}>No upcoming classes yet.</p>
        ) : (
          <div className="weeklyGrid">
            {WEEKDAY_COLUMNS.map((day) => {
              const dayItems = weeklySchedule.get(day.value) ?? [];
              return (
                <div className="weeklyDay" key={day.value}>
                  <div className="weeklyDayLabel">{day.label}</div>
                  <div className="weeklyDayPills">
                    {dayItems.length === 0 ? (
                      <p className="weeklyEmpty">No classes</p>
                    ) : (
                      dayItems.map((item) => {
                        const isActive = item.id === activeClassId;
                        return (
                          <button
                            key={`weekly-${item.id}`}
                            type="button"
                            className={`classPill${isActive ? ' classPillActive' : ''}`}
                            onClick={() => selectScheduleClass(item)}
                            aria-pressed={isActive}
                          >
                            <span className="classPillTime">{timeOnlyLabel(item.start_time)}</span>
                            <span className="classPillTitle">{item.title}</span>
                            <span className="classPillMeta">
                              {item.age_range ?? 'Ages TBA'} · {compactCaregiverLabel(item.caregiver_participation)}
                            </span>
                            <span className="classPillSeats">{compactSeatsLine(item)}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ marginTop: 18, border: '1px solid #e1d2fb', borderRadius: 14, background: '#fff', padding: 14 }}>
        <h2 style={{ fontSize: 22, margin: '0 0 10px', color: '#4f3f82' }}>First access</h2>
        <p style={{ margin: 0, color: '#6f628d', fontSize: 14 }}>
          Pre-registration is free for now. If you are new, add your child’s name and age here, then choose the class you want. Birthdays can be corrected later in My Info/People.
        </p>
        {isAuthenticated && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginTop: 12 }}>
            <label style={{ display: 'grid', gap: 6, color: '#6f628d', fontWeight: 700 }}>
              Parent first name
              <input
                value={guardianFirstName}
                onChange={(e) => setGuardianFirstName(e.target.value)}
                placeholder="First name"
                style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 10, padding: '10px 12px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6, color: '#6f628d', fontWeight: 700 }}>
              Parent last name
              <input
                value={guardianLastName}
                onChange={(e) => setGuardianLastName(e.target.value)}
                placeholder="Last name"
                style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 10, padding: '10px 12px' }}
              />
            </label>
          </div>
        )}
        {people.length > 0 && (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <label style={{ display: 'block', color: '#6f628d', fontWeight: 700 }}>
              Register for
              <select value={selectedPersonId} onChange={(e) => { setSelectedPersonId(e.target.value); setQuickChildName(''); setQuickChildAge(''); }} style={{ marginLeft: 8, padding: '6px 8px', borderRadius: 8 }}>
                {people.map((p) => <option key={`register-person-${p.id}`} value={p.id}>{p.first_name} {p.last_name ?? ''}</option>)}
                <option value={ADDITIONAL_CHILD_VALUE}>Register additional child</option>
              </select>
            </label>
            {isAddingAdditionalChild && (
              <>
                <label style={{ display: 'grid', gap: 6, color: '#6f628d', fontWeight: 700 }}>
                  Additional child’s name
                  <input
                    value={quickChildName}
                    onChange={(e) => setQuickChildName(e.target.value)}
                    placeholder="Child name"
                    style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 10, padding: '10px 12px' }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6, color: '#6f628d', fontWeight: 700 }}>
                  Child age
                  <input
                    value={quickChildAge}
                    onChange={(e) => setQuickChildAge(e.target.value)}
                    type="number"
                    min={0}
                    max={12}
                    step={0.5}
                    style={{ width: '100%', maxWidth: 220, boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 10, padding: '10px 12px' }}
                  />
                </label>
              </>
            )}
            {selectedPersonNeedsAge && (
              <label style={{ display: 'grid', gap: 6, color: '#6f628d', fontWeight: 700 }}>
                Child age
                <input
                  value={quickChildAge}
                  onChange={(e) => setQuickChildAge(e.target.value)}
                  type="number"
                  min={0}
                  max={12}
                  step={0.5}
                  style={{ width: '100%', maxWidth: 220, boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 10, padding: '10px 12px' }}
                />
              </label>
            )}
          </div>
        )}
        {isAuthenticated && people.length === 0 && (
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <label style={{ display: 'grid', gap: 6, color: '#6f628d', fontWeight: 700 }}>
              Child’s name
              <input
                value={quickChildName}
                onChange={(e) => setQuickChildName(e.target.value)}
                placeholder="Child name"
                style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 10, padding: '10px 12px' }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6, color: '#6f628d', fontWeight: 700 }}>
              Child age
              <input
                value={quickChildAge}
                onChange={(e) => setQuickChildAge(e.target.value)}
                type="number"
                min={0}
                max={12}
                step={0.5}
                style={{ width: '100%', maxWidth: 220, boxSizing: 'border-box', border: '1px solid #d8c5f6', borderRadius: 10, padding: '10px 12px' }}
              />
            </label>
          </div>
        )}
        {!isAuthenticated && (
          <p style={{ margin: '10px 0 0', color: '#6f628d', fontSize: 14 }}>
            Choose a class below and we will open email sign-in first.
          </p>
        )}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 22, margin: '0 0 10px', color: '#4f3f82' }}>✨ Upcoming classes</h2>
        {loading ? (
          <p>Loading…</p>
        ) : classes.length === 0 ? (
          <p>No upcoming classes yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {sortedClassSeries.map((series) => {
              const selectedOccurrence = activeClassId
                ? series.occurrences.find((occurrence) => occurrence.id === activeClassId) ?? null
                : null;
              const target = selectedOccurrence ?? series.occurrences[0] ?? series;
              const isActiveSeries = Boolean(selectedOccurrence);
              const isFull = target.seats_left != null && target.seats_left <= 0;
              const shouldWaitlist = isFull || Boolean(target.waitlist_offer_pending) || (target.waitlist_count ?? 0) > 0;
              const existingStatus = selectedPersonId
                ? series.occurrences
                    .map((occurrence) => registrationStatusByClassAndPerson.get(`${occurrence.id}:${selectedPersonId}`))
                    .find(Boolean)
                : undefined;
              const alreadyBooked = Boolean(existingStatus);
              return (
                <div
                  id={classCardDomId(series)}
                  key={series.id}
                  style={{
                    border: isActiveSeries ? '2px solid #8f66d8' : '1px solid #e3d4fa',
                    borderRadius: 14,
                    padding: 14,
                    background: isActiveSeries ? '#fffdf9' : '#fff',
                    boxShadow: isActiveSeries ? '0 10px 24px rgba(95,61,164,0.18)' : '0 6px 16px rgba(138, 103, 193, 0.08)',
                    scrollMarginTop: 18,
                  }}
                >
                  {isActiveSeries && (
                    <p style={{ margin: '0 0 8px', color: '#5f3da4', fontWeight: 800, fontSize: 13 }}>
                      Selected from schedule: {weekdayTimeLabel(target)}
                    </p>
                  )}
                  <h3 style={{ margin: 0 }}>
                    {series.title}{' '}
                    {series.occurrences.some((item) => item.is_popular) && (
                      <span style={{ fontSize: 12, padding: '3px 7px', borderRadius: 999, background: '#ffe4f1', color: '#9d2f65' }}>
                        Popular
                      </span>
                    )}
                  </h3>
                  <p style={{ margin: '8px 0', color: '#666' }}>
                    {classScheduleLabel(series)}
                  </p>
                  <p style={{ margin: '6px 0' }}>Category: {series.category ?? '-'}</p>
                  <p style={{ margin: '6px 0' }}>Instructor: {series.instructor_name ?? '-'}</p>
                  <p style={{ margin: '6px 0' }}>Age(s): {series.age_range ?? '-'}</p>
                  <p style={{ margin: '6px 0' }}>Caregiver: {series.caregiver_participation ?? '-'}</p>
                  <p style={{ margin: '6px 0' }}>Duration: {series.duration_minutes ?? Math.round((new Date(series.end_time).getTime() - new Date(series.start_time).getTime()) / 60000)} min</p>
                  <p style={{ margin: '6px 0' }}>Price: ${(series.price_cents / 100).toFixed(2)}</p>
                  {series.description && <p style={{ margin: '6px 0', color: '#666' }}>{series.description}</p>}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', border: '1px solid #efe3ff', borderRadius: 12, padding: 10, background: '#fcf9ff', marginTop: 12 }}>
                    <div style={{ minWidth: 220, flex: '1 1 240px', color: '#7a6d97', fontSize: 13, fontWeight: 700 }}>
                      {seatsLine(target)}
                    </div>
                    <button style={{ flex: '0 0 auto' }} onClick={() => preRegisterClass(target.id)} disabled={registeringClassId === target.id || creatingChild || alreadyBooked}>
                      {registeringClassId === target.id || creatingChild ? 'Saving...' : existingStatus === 'waitlist' ? 'Waitlisted' : alreadyBooked ? 'Registered' : shouldWaitlist ? 'Join waitlist' : 'Pre-register'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <details className="historyDetails">
          <summary className="historySummary">
            <span className="historyChevron">▸</span>
            <h2 style={{ fontSize: 22, margin: 0, color: '#4f3f82', fontWeight: 400 }}>🌙 My class history</h2>
          </summary>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <select value={historyPersonFilter} onChange={(e) => setHistoryPersonFilter(e.target.value)} style={{ padding: '6px 8px', borderRadius: 8 }}>
            <option value='all'>All family members</option>
            {people.map((p) => <option key={`hist-${p.id}`} value={p.id}>{p.first_name} {p.last_name ?? ''}</option>)}
          </select>
          <button onClick={() => setHistoryTab('upcoming')} style={historyTab === 'upcoming' ? historyTabButtonActiveStyle : historyTabButtonStyle}>
            Upcoming ({upcomingHistoryItems.length})
          </button>
          <button onClick={() => setHistoryTab('waitlist')} style={historyTab === 'waitlist' ? historyTabButtonActiveStyle : historyTabButtonStyle}>
            Waitlist ({waitlistItems.length})
          </button>
          <button onClick={() => setHistoryTab('past')} style={historyTab === 'past' ? historyTabButtonActiveStyle : historyTabButtonStyle}>
            Past ({pastHistoryItems.length})
          </button>
          <button onClick={() => setHistoryTab('cancelled')} style={historyTab === 'cancelled' ? historyTabButtonActiveStyle : historyTabButtonStyle}>
            Cancelled ({cancelledItems.length})
          </button>
          <button onClick={() => setHistoryTab('favorites')} style={historyTab === 'favorites' ? historyTabButtonActiveStyle : historyTabButtonStyle}>
            Favorites ({favoriteItems.length})
          </button>
        </div>
        {loading ? (
          <p>Loading…</p>
        ) : historyTab === 'upcoming' && visibleHistoryItems.length === 0 ? (
          <div style={{ border: '1px dashed #ccc', borderRadius: 12, padding: 16 }}>
            <p>You do not have any class bookings yet.</p>
          </div>
        ) : historyTab === 'waitlist' && visibleHistoryItems.length === 0 ? (
          <div style={{ border: '1px dashed #d8c6f2', borderRadius: 12, padding: 16, background: '#fbf8ff' }}>
            <p>No waitlisted classes.</p>
          </div>
        ) : historyTab === 'cancelled' && visibleHistoryItems.length === 0 ? (
          <div style={{ border: '1px dashed #d8b1d0', borderRadius: 12, padding: 16, background: '#fff7fc' }}>
            <p>No cancelled classes.</p>
          </div>
        ) : historyTab === 'favorites' && visibleHistoryItems.length === 0 ? (
          <div style={{ border: '1px dashed #f2d067', borderRadius: 12, padding: 16, background: '#fff9e8' }}>
            <p>No favorite classes yet.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {visibleHistoryItems.map((item) => (
              <div key={item.id} style={{ border: '1px solid #e3d4fa', borderRadius: 14, padding: 14, background: '#fff', boxShadow: '0 6px 16px rgba(138, 103, 193, 0.08)' }}>
                <h3 style={{ margin: 0 }}>{item.class?.title ?? 'Removed class'}</h3>
                <p style={{ margin: '8px 0', color: '#666' }}>
                  Person: {item.person_name} · Status:{' '}
                  <b style={{ textTransform: 'uppercase' }}>
                    {item.status === 'waitlist' ? 'waitlist' : item.attendance_display_status}
                  </b>
                </p>
                <p style={{ margin: '6px 0' }}>
                  Time: {item.class?.start_time ? new Date(item.class.start_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toLowerCase() : '-'}
                </p>
                <p style={{ margin: '6px 0' }}>Category: {item.class?.category ?? '-'}</p>
                {item.attendance_marked_at && (
                  <p style={{ margin: '6px 0', color: '#6d6480' }}>Attendance marked: {new Date(item.attendance_marked_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toLowerCase()}</p>
                )}
                {item.class?.status === 'cancelled' && (
                  <p style={{ margin: '6px 0', color: '#8a3f6b', fontWeight: 600 }}>
                    This class was cancelled by the studio and has been removed from the customer calendar.
                  </p>
                )}
                {(item.attendance_status === 'attended' || item.status === 'attended') && (
                  <div style={{ marginTop: 10, border: '1px solid #efe3ff', borderRadius: 10, padding: 10, background: '#fcf9ff' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                      <button
                        onClick={() => saveClassReflection(item.id, !item.customer_favorite, noteDrafts[item.id] ?? item.customer_note ?? '')}
                        disabled={savingClassMemoId === item.id}
                        style={{
                          borderRadius: 12,
                          border: item.customer_favorite ? '1px solid #f7ca45' : '1px solid #d9c8f7',
                          background: item.customer_favorite ? '#fff4cc' : '#f3ebff',
                          color: item.customer_favorite ? '#7a5200' : '#5f3da4',
                          padding: '8px 12px',
                          fontWeight: 700,
                        }}
                      >
                        {item.customer_favorite ? '★ Favorite' : '☆ Mark favorite'}
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      placeholder="Optional personal note"
                      value={noteDrafts[item.id] ?? item.customer_note ?? ''}
                      onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      style={{ width: '100%' }}
                    />
                    <div style={{ marginTop: 8 }}>
                      <button
                        onClick={() => saveClassReflection(item.id, item.customer_favorite, noteDrafts[item.id] ?? '')}
                        disabled={savingClassMemoId === item.id}
                      >
                        {savingClassMemoId === item.id ? 'Saving...' : 'Save note'}
                      </button>
                    </div>
                  </div>
                )}
                {item.status !== 'cancelled' && item.class?.status !== 'cancelled' && (
                  <button onClick={() => cancelRegistration(item.id)} disabled={cancellingId === item.id}>
                    {cancellingId === item.id ? 'Cancelling...' : item.status === 'waitlist' ? 'Leave Waitlist' : 'Cancel Booking'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        </details>
      </section>

      <p style={{ marginTop: 20 }}>
        <Link href="/landing" style={{ display: 'inline-flex', border: '1px solid #d9c8f7', borderRadius: 12, padding: '10px 14px', color: '#5f3da4', textDecoration: 'none', fontWeight: 700 }}>
          ← Back to my dashboard
        </Link>
      </p>
    <style jsx>{`
  .weeklySchedule {
    margin-top: 18px;
    border: 1px solid #dfccfb;
    border-radius: 16px;
    background: #fff;
    padding: 14px;
    box-shadow: 0 10px 22px rgba(120,87,177,0.08);
  }
  .weeklyScheduleHeader {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .weeklyGrid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 10px;
    margin-top: 14px;
  }
  .weeklyDay {
    min-width: 0;
    border: 1px solid #eadfff;
    border-radius: 14px;
    background: #fbf8ff;
    padding: 10px;
  }
  .weeklyDayLabel {
    color: #4f3f82;
    font-size: 13px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 8px;
  }
  .weeklyDayPills {
    display: grid;
    gap: 8px;
  }
  .weeklyEmpty {
    margin: 0;
    color: #9588aa;
    font-size: 13px;
  }
  .classPill {
    width: 100%;
    min-width: 0;
    display: grid;
    gap: 3px;
    text-align: left;
    border: 1px solid #d9c8f7;
    border-radius: 12px;
    background: #fff;
    color: #4f3f82;
    padding: 9px 10px;
    cursor: pointer;
    box-shadow: 0 4px 10px rgba(138,103,193,0.08);
  }
  .classPillActive {
    border-color: #8f66d8;
    background: #f4edff;
    box-shadow: 0 6px 14px rgba(95,61,164,0.16);
  }
  .classPillTime {
    color: #5f3da4;
    font-size: 12px;
    font-weight: 900;
  }
  .classPillTitle {
    min-width: 0;
    color: #34284f;
    font-size: 13px;
    font-weight: 800;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .classPillMeta,
  .classPillSeats {
    min-width: 0;
    color: #6f628d;
    font-size: 12px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .classPillSeats {
    color: #7b4d1f;
    font-weight: 800;
  }
  .historySummary {
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    margin: 0 0 10px;
  }
  .historySummary::-webkit-details-marker { display: none; }
  .historyChevron {
    color: #4f3f82;
    font-size: 16px;
    transform: translateY(1px);
  }
  .historyDetails[open] .historyChevron {
    transform: rotate(90deg) translateX(1px);
  }
  @media (max-width: 900px) {
    .weeklyGrid {
      display: flex;
      overflow-x: auto;
      padding-bottom: 4px;
      scroll-snap-type: x proximity;
    }
    .weeklyDay {
      flex: 0 0 220px;
      scroll-snap-align: start;
    }
  }
`}</style>
    </main>
  );
}
