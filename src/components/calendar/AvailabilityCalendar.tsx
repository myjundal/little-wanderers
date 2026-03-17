'use client';

import { useMemo, useState } from 'react';

export type CalendarSlot = {
  id: string;
  start: string;
  end: string;
  label: string;
  status: 'available' | 'booked' | 'full' | 'mine';
};

type Props = {
  title: string;
  subtitle?: string;
  slots: CalendarSlot[];
};

const statusColor: Record<CalendarSlot['status'], string> = {
  available: '#b084f9',
  booked: '#f39db0',
  full: '#7f7f9b',
  mine: '#5f9df3',
};

const statusLabel: Record<CalendarSlot['status'], string> = {
  available: 'Available',
  booked: 'Booked',
  full: 'Full',
  mine: 'My booking',
};

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function AvailabilityCalendar({ title, subtitle, slots }: Props) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const { dayMap, calendarDays } = useMemo(() => {
    const map = new Map<string, CalendarSlot[]>();
    slots.forEach((slot) => {
      const key = ymd(new Date(slot.start));
      const existing = map.get(key) ?? [];
      existing.push(slot);
      map.set(key, existing);
    });

    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const firstWeekDay = first.getDay();
    const start = new Date(first);
    start.setDate(first.getDate() - firstWeekDay);

    const days: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }

    return { dayMap: map, calendarDays: days };
  }, [slots, cursor]);

  return (
    <section style={{ marginTop: 18, border: '1px solid #e7daf9', borderRadius: 16, padding: 14, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>
          {subtitle && <p style={{ margin: '4px 0 0', color: '#6f628d', fontSize: 13 }}>{subtitle}</p>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>←</button>
          <b>{cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</b>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>→</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6, marginTop: 12 }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} style={{ textAlign: 'center', fontWeight: 700, fontSize: 12, color: '#6f628d' }}>{d}</div>
        ))}
        {calendarDays.map((d) => {
          const key = ymd(d);
          const list = dayMap.get(key) ?? [];
          const inMonth = d.getMonth() === cursor.getMonth();
          return (
            <div key={key} style={{ minHeight: 86, border: '1px solid #efe6fc', borderRadius: 10, padding: 6, background: inMonth ? '#fff' : '#faf7ff', opacity: inMonth ? 1 : 0.7 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#5d4f88' }}>{d.getDate()}</div>
              <div style={{ display: 'grid', gap: 4, marginTop: 5 }}>
                {list.slice(0, 2).map((slot) => (
                  <div key={slot.id} title={`${slot.label} (${statusLabel[slot.status]})`} style={{ fontSize: 10, lineHeight: 1.2, borderRadius: 999, padding: '2px 6px', background: `${statusColor[slot.status]}22`, color: statusColor[slot.status], border: `1px solid ${statusColor[slot.status]}66`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {new Date(slot.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} {slot.label}
                  </div>
                ))}
                {list.length > 2 && <div style={{ fontSize: 10, color: '#7d709b' }}>+{list.length - 2} more</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        {Object.entries(statusLabel).map(([k, v]) => (
          <span key={k} style={{ fontSize: 12, color: '#55417f' }}>
            <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 99, marginRight: 6, background: statusColor[k as CalendarSlot['status']] }} />
            {v}
          </span>
        ))}
      </div>
    </section>
  );
}
