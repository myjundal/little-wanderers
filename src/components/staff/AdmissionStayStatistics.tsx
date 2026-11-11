'use client';

import { useEffect, useState } from 'react';
import { admissionDate, admissionTime, admissionStayCsv, stayLabel, type admissionStayStatistics } from '@/lib/admission-stays';
import styles from './admission-visits.module.css';

type Statistics = ReturnType<typeof admissionStayStatistics>;
type Report = Statistics & { start: string; end: string };

export default function AdmissionStayStatistics({ refreshKey }: { refreshKey: number }) {
  const [start, setStart] = useState(() => admissionDate(new Date().toISOString()));
  const [end, setEnd] = useState(() => admissionDate(new Date().toISOString()));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setReport(null);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/admission/stays?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to load stay statistics.');
        if (!controller.signal.aborted) setReport(result);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to load stay statistics.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [start, end, refreshKey]);

  function recent(days: number) {
    const today = admissionDate(new Date().toISOString());
    setEnd(today);
    setStart(new Date(Date.parse(`${today}T12:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10));
  }

  function exportCsv() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([admissionStayCsv(report.completed)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `open-play-stays-${report.start}-${report.end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <section className={styles.panel} aria-label="Visit duration statistics">
    <h2>Visit duration statistics</h2>
    <div className={styles.actions}>
      <button type="button" onClick={() => recent(1)}>Today</button>
      <button type="button" onClick={() => recent(7)}>Last 7 days</button>
      <button type="button" onClick={() => recent(30)}>Last 30 days</button>
    </div>
    <div className={styles.dateRange}>
      <label>From<input type="date" value={start} max={end} onChange={event => setStart(event.target.value)} /></label>
      <label>To<input type="date" value={end} min={start} max={admissionDate(new Date().toISOString())} onChange={event => setEnd(event.target.value)} /></label>
    </div>
    {loading && <p role="status">Loading visit durations…</p>}
    {error && <p role="alert">{error}</p>}
    {report && <>
      <div className={styles.metrics}>
        {[['Completed family visits', report.completed.length], ['Average family stay', report.average_minutes === null ? '—' : stayLabel(report.average_minutes)],
          ['Longest family stay', report.longest_minutes === null ? '—' : stayLabel(report.longest_minutes)], ['Total guest-hours', (report.guest_minutes / 60).toFixed(1)]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </div>
      <p className={styles.note}>Family stay runs from the first arrival to the last departure. Average and longest stays include fully checked-out families only. Guest-hours add each guest’s recorded time.</p>
      {report.without_checkout > 0 && <p>{report.without_checkout} guest visit{report.without_checkout === 1 ? '' : 's'} without a recorded departure. These times are excluded.</p>}
      {!report.completed.length ? <p>No completed family visits in this date range yet.</p> : <>
        <button type="button" onClick={exportCsv}>Download CSV</button>
        <div className={styles.tableWrap}><table><caption>Completed family visits · Eastern time</caption><thead><tr><th>Date</th><th>Family</th><th>Guests</th><th>In</th><th>Out</th><th>Stay</th></tr></thead>
          <tbody>{report.completed.map(row => <tr key={`${row.date}:${row.household_id}`}><td>{row.date}</td><th scope="row">{row.name}</th><td>{row.guests}</td><td>{admissionTime(row.checked_in_at)}</td><td>{admissionTime(row.checked_out_at)}</td><td>{stayLabel(row.minutes)}</td></tr>)}</tbody>
        </table></div>
      </>}
    </>}
  </section>;
}
