'use client';

import { useEffect, useState } from 'react';

type Prefs = {
  less_crowded_enabled: boolean;
  notify_when_level_at_or_below: 'light' | 'moderate' | 'busy' | 'near_capacity';
  quiet_hours_enabled: boolean;
  quiet_start_hour: number | null;
  quiet_end_hour: number | null;
  timezone_offset_minutes: number;
};

const defaultPrefs: Prefs = {
  less_crowded_enabled: true,
  notify_when_level_at_or_below: 'moderate',
  quiet_hours_enabled: false,
  quiet_start_hour: 21,
  quiet_end_hour: 7,
  timezone_offset_minutes: 0,
};

export default function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/push/preferences', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (json?.ok && json.preferences) {
          setPrefs((prev) => ({ ...prev, ...json.preferences }));
        }
      })
      .catch(() => undefined);
  }, []);

  const save = async () => {
    const payload = {
      ...prefs,
      timezone_offset_minutes: new Date().getTimezoneOffset(),
    };

    const res = await fetch('/api/push/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage('Could not save your notification settings right now.');
      return;
    }

    setMessage('Your notification preferences are saved.');
  };

  return (
    <section style={{ marginTop: 16, padding: 14, border: '1px solid #ddd', borderRadius: 12 }}>
      <h3>Notification Preferences</h3>
      <p style={{ color: '#6d6480' }}>Choose when you’d like “less crowded now” updates.</p>

      <label style={{ display: 'block', marginTop: 8 }}>
        <input
          type="checkbox"
          checked={prefs.less_crowded_enabled}
          onChange={(e) => setPrefs((prev) => ({ ...prev, less_crowded_enabled: e.target.checked }))}
        />{' '}
        Send less-crowded alerts
      </label>

      <label style={{ display: 'block', marginTop: 10 }}>
        Notify me when crowd level is at or below{' '}
        <select
          value={prefs.notify_when_level_at_or_below}
          onChange={(e) => setPrefs((prev) => ({ ...prev, notify_when_level_at_or_below: e.target.value as Prefs['notify_when_level_at_or_below'] }))}
        >
          <option value="light">Light</option>
          <option value="moderate">Moderate</option>
          <option value="busy">Busy</option>
          <option value="near_capacity">Near Capacity</option>
        </select>
      </label>

      <label style={{ display: 'block', marginTop: 10 }}>
        <input
          type="checkbox"
          checked={prefs.quiet_hours_enabled}
          onChange={(e) => setPrefs((prev) => ({ ...prev, quiet_hours_enabled: e.target.checked }))}
        />{' '}
        Enable quiet hours
      </label>

      {prefs.quiet_hours_enabled && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <label>Start hour (0-23) <input type="number" min={0} max={23} value={prefs.quiet_start_hour ?? 21} onChange={(e) => setPrefs((prev) => ({ ...prev, quiet_start_hour: Number(e.target.value) }))} /></label>
          <label>End hour (0-23) <input type="number" min={0} max={23} value={prefs.quiet_end_hour ?? 7} onChange={(e) => setPrefs((prev) => ({ ...prev, quiet_end_hour: Number(e.target.value) }))} /></label>
        </div>
      )}

      <button type="button" onClick={save} style={{ marginTop: 12 }}>Save Notification Settings</button>
      {message && <p style={{ marginTop: 8, color: '#2f7a44' }}>{message}</p>}
    </section>
  );
}
