'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { RevenueReport } from '@/lib/service-day-revenue';
import styles from './owner-revenue.module.css';

const usd = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100);
export default function OwnerRevenue({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true); setReport(null); setError('');
    fetch(`/api/admin/revenue?date=${encodeURIComponent(date)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to load revenue.');
        if (!controller.signal.aborted) setReport(data.report);
      }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load revenue.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [date, refresh]);
  const shiftDate = (days: number) => setDate(new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10));
  return <main className={styles.main}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>PRIVATE · OWNER ONLY</p><h1>방문일 기준 매출</h1><p className={styles.subtitle}>미리 받은 결제도 예약된 방문일에 한 번만 반영합니다.</p></div>
      <Link className={styles.back} href="/staff/dashboard">← 대시보드</Link>
    </header>
    <section className={styles.toolbar} aria-label="집계 날짜 선택">
      <label htmlFor="revenue-date">집계 날짜 <input id="revenue-date" type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} /></label>
      <div className={styles.actions}><button type="button" onClick={() => shiftDate(-1)} aria-label="이전 날짜">←</button><button type="button" onClick={() => setDate(initialDate)}>오늘</button><button type="button" onClick={() => shiftDate(1)} aria-label="다음 날짜">→</button><button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>새로고침</button></div>
      <p>뉴욕 시간 · 매일 저녁 8:30 자동 보고</p>
    </section>
    {busy && <p role="status" className={styles.notice}>예약과 Square 결제 내역을 확인하고 있습니다…</p>}
    {error && <p role="alert" className={styles.warning}>{error} 금액은 확인 후 표시됩니다.</p>}
    {report && <>
      {!report.complete && <div role="alert" className={styles.warning}><strong>확인된 내역의 부분 합계입니다.</strong> 확인 필요 {report.review_count}건{report.issues.length ? ' · 일부 자료를 불러오지 못했습니다.' : '. 아래 내역을 확인해 주세요.'}</div>}
      <div className={styles.metrics}>
        <section className={`${styles.metric} ${styles.featured}`}><span>{date > initialDate ? '방문 예정일 귀속 수납액' : '방문일 매출 · 수납액 기준'}</span><strong>{usd(report.net_cents)}</strong><small>방문 확인 {usd(report.visited_cents)} · 방문 미확인 {usd(report.reserved_cents)}</small></section>
        <section className={styles.metric}><span>이전에 받은 선결제</span><strong>{usd(report.prepaid_cents)}</strong><small>왼쪽 매출에 포함된 금액</small></section>
        <section className={styles.metric}><span>방문일에 받은 결제</span><strong>{usd(report.same_day_cents)}</strong><small>왼쪽 매출에 포함된 금액</small></section>
        <section className={styles.metric}><span>미수금</span><strong>{usd(report.due_cents)}</strong><small>아직 받지 않은 금액</small></section>
      </div>
      <section className={styles.panel}><div className={styles.sectionHeading}><h2>항목별 매출</h2><span>USD · 세금과 팁 제외</span></div><div className={styles.categories}>{report.categories.map(item => <div key={item.category}><span>{item.label}</span><strong>{usd(item.net_cents)}</strong><small>{item.count}건 · 미수 {usd(item.due_cents)}</small></div>)}</div></section>
      <div className={styles.reconciliation}><span>환불 차감 <strong>{usd(report.refunded_cents)}</strong></span><span>방문일 이후 받은 결제 <strong>{usd(report.later_paid_cents)}</strong></span><span>확인 필요 <strong>{report.review_count}건</strong></span></div>
      <section className={styles.panel}><div className={styles.sectionHeading}><h2>예약·방문 상세</h2><span>{report.rows.length}건</span></div>
        {!report.rows.length ? <p className={styles.empty}>선택한 날짜의 예약·방문 내역이 없습니다.</p> : <div className={styles.scroll}><table className={styles.table}><thead><tr><th>내역</th><th>방문·예약 상태</th><th>방문일 매출</th><th>선결제 포함</th><th>미수금</th></tr></thead><tbody>{report.rows.map(row => <tr key={row.id}>
          <td><strong>{row.label}</strong>{row.issues.map(issue => <small className={styles.issue} key={issue}>{issue}</small>)}{row.refunded_cents > 0 && <small>환불 {usd(row.refunded_cents)}</small>}{(row.tax_cents > 0 || row.tip_cents > 0) && <small>별도 세금 {usd(row.tax_cents)} · 팁 {usd(row.tip_cents)}</small>}</td>
          <td><span className={row.issues.length ? styles.review : styles.badge}>{row.issues.length ? '확인 필요' : row.cancelled ? '취소' : row.attendance === 'visited' ? '방문 확인' : '방문 미확인'}</span></td>
          <td>{row.issues.length ? '집계 제외' : usd(row.net_cents)}</td><td>{usd(row.prepaid_cents)}</td><td>{row.issues.length ? '확인 필요' : usd(row.due_cents)}</td>
        </tr>)}</tbody></table></div>}
      </section>
      {!!report.issues.length && <section className={styles.warning}><h2>자료 확인 필요</h2><ul>{report.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></section>}
      <details className={styles.method}><summary>계산 기준</summary><p>선결제는 최신 예약 방문일에 귀속합니다. 예약과 체크인에 같은 결제가 연결되어 있어도 한 번만 합산합니다. 방문 확인 전 금액은 따로 표시하며, 미래 날짜의 금액은 방문 예정일 기준 수납액입니다.</p><p>수업 시리즈 결제는 등록된 전체 회차에 균등 배분합니다. 나누어떨어지지 않는 센트는 날짜가 빠른 회차부터 배분합니다. 환불은 원래 서비스 날짜의 매출에서 차감하고, 미수금을 새로 만들지 않습니다.</p><p>멤버십으로 포함된 입장료는 추가 매출로 계산하지 않습니다. 멤버십·다회권 판매액의 일별 배분, 결제가 연결되지 않은 예약, 취소 후 남은 결제, 세금·팁이 섞인 환불은 자동 추정하지 않습니다. 확인 필요 항목은 합계에서 제외합니다.</p><p>실시간으로 조회한 현재 상태입니다. 늦은 결제·환불·예약일 변경에 따라 지난 날짜의 합계도 달라질 수 있습니다.</p></details>
      <p className={styles.updated}>마지막 확인: {new Date(report.generated_at).toLocaleString('ko-KR', { timeZone: 'America/New_York' })} (뉴욕)</p>
    </>}
  </main>;
}
