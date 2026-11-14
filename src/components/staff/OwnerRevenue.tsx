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
  const partyReviewCount = report?.rows.filter(row => row.category === 'party' && row.issues.length > 0).length ?? 0;
  const shiftDate = (days: number) => setDate(new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10));
  return <main className={styles.main}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>PRIVATE · OWNER ONLY</p><h1>전체 매출</h1><p className={styles.subtitle}>클래스는 각 수업일, 파티와 예약 서비스는 방문일, 카페 등 기타 판매는 결제일에 반영합니다.</p></div>
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
        <section className={`${styles.metric} ${styles.featured}`}><span>{date > initialDate ? '방문 예정일 귀속 수납액' : '전체 매출 · 수납액 기준'}</span><strong>{usd(report.net_cents)}</strong><small>방문 확인 {usd(report.visited_cents)} · 방문 미확인 {usd(report.reserved_cents)} · 기타 판매 {usd(report.sales_cents)}</small></section>
        <section className={styles.metric}><span>이전에 받은 선결제</span><strong>{usd(report.prepaid_cents)}</strong><small>왼쪽 매출에 포함된 금액</small></section>
        <section className={styles.metric}><span>매출에 포함된 당일 결제</span><strong>{usd(report.same_day_cents)}</strong><small>왼쪽 매출에 포함된 금액</small></section>
        <section className={styles.metric}><span>미수금</span><strong>{usd(report.due_cents)}</strong><small>아직 받지 않은 금액</small></section>
      </div>
      <section className={styles.panel} aria-label="파티 매출 집계">
        <div className={styles.sectionHeading}><h2>파티일 기준 매출</h2><strong>{usd(report.party_cents)}</strong></div>
        {partyReviewCount > 0 && <p role="status" className={styles.warning}>파티 {partyReviewCount}건의 결제 확인이 필요합니다. 파티 매출과 미수금은 확인된 내역의 부분 합계이며, 연결되지 않은 금액은 확인 전까지 합계에서 제외합니다.</p>}
        <p>선택한 날짜에 열리는 파티의 확인된 수납액입니다. 디파짓과 잔금을 합쳐 파티 날짜에 한 번만 반영합니다.</p>
        <div className={styles.reconciliation}><span>미리 받은 디파짓·선결제 <strong>{usd(report.party_prepaid_cents)}</strong></span><span>파티 미수금 <strong>{usd(report.party_due_cents)}</strong></span></div>
        <p><strong>선택한 날 받은 파티 결제 {usd(report.party_received_today_cents)}</strong> · 아래 결제 내역은 돈을 받은 날짜를 확인하는 용도이며 매출에 다시 더하지 않습니다. 세금·팁·기프트카드 사용액 제외, 환불 차감 전입니다.</p>
        {report.party_receipts.length > 0 && <div className={styles.scroll}><table className={styles.table}><thead><tr><th>파티</th><th>파티 날짜</th><th>당일 수납</th><th>누적 환불</th></tr></thead><tbody>{report.party_receipts.map((payment, index) => <tr key={`${payment.service_id}:${payment.id}:${index}`}><td>{payment.label}{payment.review && <small className={styles.issue}>예약 연결 또는 결제 확인 필요</small>}</td><td>{payment.service_date ?? '연결 필요'}</td><td>{usd(payment.received_cents)}</td><td>{usd(payment.refunded_cents)}</td></tr>)}</tbody></table></div>}
        {report.unallocated_party_cents > 0 && <p className={styles.warning}>미배분 파티 수납 <strong>{usd(report.unallocated_party_cents)}</strong> · 파티 예약 연결이 필요해 매출 합계에서 제외했습니다.</p>}
      </section>
      <section className={styles.panel} aria-label="클래스 매출 집계"><div className={styles.sectionHeading}><h2>수업일 기준 클래스 매출</h2><strong>{usd(report.class_cents)}</strong></div><p>선택한 날짜의 수업에 해당하는 금액만 포함합니다. 예: 5회 수업을 $150에 결제하면 각 수업일에 $30씩 반영합니다.</p>{report.unallocated_class_cents > 0 && <p className={styles.warning}>미배분 클래스 선결제 <strong>{usd(report.unallocated_class_cents)}</strong> · 결제는 확인되었지만 수업일 연결이 필요해 매출 합계에 넣지 않았습니다.</p>}</section>
      <section className={styles.panel}><div className={styles.sectionHeading}><h2>항목별 매출</h2><span>USD · 세금과 팁 제외</span></div><div className={styles.categories}>{report.categories.map(item => <div key={item.category}><span>{item.label}</span><strong>{usd(item.net_cents)}</strong><small>{item.count}건 · 미수 {usd(item.due_cents)}</small></div>)}</div></section>
      <div className={styles.reconciliation}><span>환불 차감 <strong>{usd(report.refunded_cents)}</strong></span><span>방문일 이후 받은 결제 <strong>{usd(report.later_paid_cents)}</strong></span><span>확인 필요 <strong>{report.review_count}건</strong></span><span>기프트카드 사용 · 중복 제외 <strong>{usd(report.redeemed_cents)}</strong></span></div>
      <section className={styles.panel}><div className={styles.sectionHeading}><h2>전체 매출 상세</h2><span>{report.rows.length}건</span></div>
        {!report.rows.length ? <p className={styles.empty}>선택한 날짜의 예약·방문·판매 내역이 없습니다.</p> : <div className={styles.scroll}><table className={styles.table}><thead><tr><th>내역</th><th>상태</th><th>매출</th><th>선결제 포함</th><th>미수금</th></tr></thead><tbody>{report.rows.map(row => <tr key={row.id}>
          <td><strong>{row.label}</strong>{row.issues.map(issue => <small className={styles.issue} key={issue}>{issue}</small>)}{row.category === 'party' && row.payment_details.map(payment => <small key={payment.id}>{payment.date} 결제 {usd(payment.received_cents)}{payment.refunded_cents > 0 ? ` · 누적 환불 ${usd(payment.refunded_cents)}` : ''}</small>)}{row.refunded_cents > 0 && <small>환불 {usd(row.refunded_cents)}</small>}{(row.tax_cents > 0 || row.tip_cents > 0) && <small>별도 세금 {usd(row.tax_cents)} · 팁 {usd(row.tip_cents)}</small>}</td>
          <td><span className={row.issues.length ? styles.review : styles.badge}>{['unallocated_class', 'unallocated_party'].includes(row.recognition ?? '') ? '미배분 선결제' : row.issues.length ? '확인 필요' : row.cancelled ? '취소' : row.attendance === 'sale' ? '결제일 판매' : row.attendance === 'visited' ? '방문 확인' : '방문 미확인'}</span></td>
          <td>{['unallocated_class', 'unallocated_party'].includes(row.recognition ?? '') ? `${usd(row.received_cents - row.refunded_cents - row.redeemed_cents)} · 배분 대기` : row.issues.length ? '집계 제외' : usd(row.net_cents)}</td><td>{usd(row.prepaid_cents)}</td><td>{row.issues.length ? '확인 필요' : usd(row.due_cents)}</td>
        </tr>)}</tbody></table></div>}
      </section>
      {!!report.issues.length && <section className={styles.warning}><h2>자료 확인 필요</h2><ul>{report.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></section>}
      <details className={styles.method}><summary>계산 기준</summary><p>선결제는 최신 예약 방문일에 귀속합니다. 예약과 체크인에 같은 결제가 연결되어 있어도 한 번만 합산합니다. 방문 확인 전 금액은 따로 표시하며, 미래 날짜의 금액은 방문 예정일 기준 수납액입니다.</p><p>파티 디파짓과 잔금은 현재 파티 예약일에 합산합니다. 아직 받지 않은 잔금은 미수금으로 표시하고, 받은 날짜의 수납 내역은 별도로 보여줍니다. 결제와 연결되지 않은 파티는 확인 필요로 남기며 금액이나 이름만으로 연결하지 않습니다. 이 표는 수납액 기준 운영 보고서이며 세금 신고용 회계 장부와는 별개입니다.</p><p>일반 클래스는 결제 때 선택한 수업일별 금액으로 반영합니다. 수업 시리즈 결제는 할인 후 실제 금액을 등록된 전체 회차에 균등 배분합니다. 현장 시리즈 결제도 상품의 고유 ID로 프로그램이 확인되면 같은 기준을 적용합니다. 수업일을 알 수 없는 클래스 결제는 결제일 매출 대신 미배분 선결제로 표시합니다. 나누어떨어지지 않는 센트는 날짜가 빠른 회차부터 배분합니다. 환불은 원래 수업일의 금액에서 차감하고 미수금을 새로 만들지 않습니다.</p><p>멤버십으로 포함된 입장료는 추가 매출로 계산하지 않습니다. 결제가 연결되지 않은 예약, 취소 후 남은 결제, 세금·팁이 섞인 환불은 자동 추정하지 않습니다. 확인 필요 항목은 합계에서 제외합니다.</p><p>Square 전체 결제를 조회해 카페·기프트카드·멤버십·다회권·기타 판매를 결제일에 포함합니다. 기프트카드는 구매일에 매출로 계산하고, 사용한 금액은 다시 매출에 더하지 않습니다. 현금도 Square에 기록된 결제에 포함되며, 세금과 팁은 매출에서 제외합니다.</p><p>실시간으로 조회한 현재 상태입니다. 늦은 결제·환불·예약일 변경에 따라 지난 날짜의 합계도 달라질 수 있습니다.</p></details>
      <p className={styles.updated}>마지막 확인: {new Date(report.generated_at).toLocaleString('ko-KR', { timeZone: 'America/New_York' })} (뉴욕)</p>
    </>}
  </main>;
}
