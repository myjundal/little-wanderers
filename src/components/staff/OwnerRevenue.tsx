'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { RevenueReport } from '@/lib/service-day-revenue';
import styles from './owner-revenue.module.css';

const usd = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount / 100);
const sourceLabel = (id: string) => id.startsWith('booking:') ? '입장 예약' : id.startsWith('visit:') ? '입장 기록' : id.startsWith('square:') ? 'Square 판매' : id.startsWith('party:') ? '파티 예약' : '수업';
const issueText = (issue: string) => ({
  'Visit payment needs a linked production receipt.': '입장 기록과 결제 영수증의 연결을 확인해 주세요.',
  'Paid reservation has no linked production order.': '결제 완료로 표시된 예약의 영수증 연결을 확인해 주세요.',
  'Party payments have no linked production order.': '파티 예약의 결제 영수증이 연결되지 않았습니다.',
  'Cancelled service retains payment; review its refund or cancellation fee.': '취소된 예약에 결제가 남아 있습니다. 환불 또는 취소 수수료 확인이 필요합니다.',
  'No-show reservation requires revenue review.': '노쇼로 표시된 예약입니다. 결제와 취소 규정 확인이 필요합니다.',
  'More than one booking or visit matches a child.': '예약과 체크인이 중복 연결될 수 있어 확인이 필요합니다.',
  'Live Square receipt verification is unavailable.': 'Square 결제 영수증을 확인하지 못했습니다.',
  'The shared order total does not match its service allocations.': '영수증 금액과 연결된 서비스 금액이 달라 확인이 필요합니다.',
}[issue] ?? issue);

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
  const partyReviewCount = report?.rows.filter(row => row.category === 'party' && row.issues.length > 0).length ?? 0;
  const detailRows = report?.rows.filter(row => row.received_cents > 0 || row.due_cents > 0 || row.pending_payment_cents > 0 || row.issues.length > 0) ?? [];
  const paymentChecks = report ? [...report.admission.payment_unconfirmed, ...report.admission.visit_unconfirmed, ...report.admission.other_review] : [];
  const checkAmount = (rows: RevenueReport['rows']) => rows.reduce((sum, row) => sum + row.pending_payment_cents, 0);
  return <main className={styles.main}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>PRIVATE · OWNER ONLY</p><h1>매출 보고서</h1><p className={styles.subtitle}>클래스는 내 몫 30%만 매출 합계에 반영합니다.</p></div>
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
      {!report.complete && <div role="alert" className={styles.warning}><strong>확인된 결제만 합산했습니다.</strong> 확인 필요 {report.review_count}개 내역{report.issues.length ? ' · 일부 자료를 불러오지 못했습니다.' : ' · 아래 확인 대상 내역을 확인해 주세요.'}</div>}
      <div className={styles.metrics}>
        <section className={`${styles.metric} ${styles.featured}`}><span>{date > initialDate ? '예정 서비스에 배정된 결제액' : '확인된 매출 · 내 몫 기준'}</span><strong>{usd(report.net_cents)}</strong><small>세금·팁 제외 · 카드 수수료 차감 전<br />클래스는 강사 70% 제외 · 내 몫 30% 포함</small></section>
        <section className={styles.metric}><span>위 매출 중 선결제</span><strong>{usd(report.prepaid_cents)}</strong><small>방문·수업·파티일 전에 받은 금액</small></section>
        <section className={styles.metric}><span>위 매출 중 당일 결제</span><strong>{usd(report.same_day_cents)}</strong><small>선택한 날짜에 받은 결제분</small></section>
        <section className={styles.metric}><span>결제·예약 확인 필요</span><strong>{report.review_count}<small>개 내역</small></strong><small>방문 인원과 별도로 집계합니다.</small></section>
      </div>

      <section className={styles.panel} aria-label="입장 매출 집계">
        <div className={styles.sectionHeading}><h2>입장 매출 · Open Play</h2><strong>{usd(report.admission.net_cents)}</strong></div>
        <div className={styles.reconciliation}><span>예약·입장 기록에 연결된 결제 <strong>{usd(report.admission.linked_cents)}</strong></span><span>방문 연결이 미확인된 Square 입장 결제 <strong>{usd(report.admission.unlinked_square_cents)}</strong></span></div>
        <p className={styles.explanation}>두 금액을 합친 확인 결제액입니다. 현장 입장과 예약 입장을 함께 집계하며, 판매항목 수를 방문 인원으로 계산하지 않습니다.</p>
      </section>

      <section className={styles.panel} aria-label="실제 방문 인원">
        <div className={styles.sectionHeading}><h2>실제 방문 인원</h2><span>선택일에 체크인한 사람 · 같은 사람은 한 번만</span></div>
        {report.visitor_stats ? <>
          <div className={styles.categories}><div><span>아동</span><strong>{report.visitor_stats.children}명</strong></div><div><span>성인</span><strong>{report.visitor_stats.adults}명</strong></div>{report.visitor_stats.unknown > 0 && <div><span>구분 확인 필요</span><strong>{report.visitor_stats.unknown}명</strong></div>}<div><span>합계</span><strong>{report.visitor_stats.total}명</strong></div></div>
          {!report.visitor_stats.complete && <p className={styles.warning}>방문 인원 자료 일부를 확인하지 못했습니다. 확인된 기록만 표시합니다.</p>}
          <p className={styles.explanation}>동반 성인·멤버십 입장도 포함한 체크인 인원입니다. 예약 전용 인원이나 결제 건수를 더하지 않습니다.</p>
          <div className={styles.reconciliation}><span>취소 제외 예약 <strong>{report.visitor_stats.reservations}건</strong></span><span>체크인 확인 예약 <strong>{report.visitor_stats.visited_reservations}건</strong></span><span>체크인 미확인 예약 <strong>{report.visitor_stats.unvisited_reservations}건</strong></span>{report.visitor_stats.declared_no_shows > 0 && <span>노쇼로 표시된 예약 <strong>{report.visitor_stats.declared_no_shows}건</strong></span>}</div>
        </> : <p className={styles.explanation}>방문 인원 자료를 확인하지 못했습니다.</p>}
      </section>

      {paymentChecks.length > 0 && <section className={styles.panel} aria-label="입장 결제 확인 대상">
        <div className={styles.sectionHeading}><h2>입장 결제 확인 대상</h2><span>{paymentChecks.length}개 내역 · 매출·확정 잔금에 미포함</span></div>
        <p className={styles.explanation}>기록에 결제가 없거나 연결을 확인해야 하는 내역입니다. 별도 Square 결제와 대조해야 하며, 아래 금액을 추가로 받을 돈으로 확정하지 않습니다. 체크인 미확인은 노쇼 확정이 아닙니다.</p>
        <div className={styles.scroll}><table className={styles.table}><thead><tr><th>확인 대상</th><th>기록 수</th><th>기록상 미확인 금액</th></tr></thead><tbody>
          <tr><td>방문 확인 · 결제 연결 미확인</td><td>{report.admission.payment_unconfirmed.length}개 입장 내역</td><td>{usd(checkAmount(report.admission.payment_unconfirmed))}</td></tr>
          <tr><td>방문 미확인 · 미결제 예약</td><td>{report.admission.visit_unconfirmed.length}개 예약 내역</td><td>{usd(checkAmount(report.admission.visit_unconfirmed))}</td></tr>
          {report.admission.other_review.length > 0 && <tr><td>영수증·취소·중복 등 추가 확인</td><td>{report.admission.other_review.length}개 내역</td><td>개별 확인 필요</td></tr>}
        </tbody></table></div>
      </section>}

      <section className={styles.panel}><div className={styles.sectionHeading}><h2>항목별 확인 매출</h2><span>USD · 세금과 팁 제외</span></div><div className={styles.categories}>{report.categories.map(item => <div key={item.category}><span>{item.category === 'class' ? '클래스 · 내 몫 30%' : item.label}</span><strong>{usd(item.net_cents)}</strong></div>)}</div></section>

      <section className={styles.panel} aria-label="클래스 수입 배분">
        <div className={styles.sectionHeading}><h2>클래스 수입 · 7:3 배분</h2><span>강사 70% · 내 몫 30%</span></div>
        <div className={`${styles.categories} ${styles.classSplit}`}>
          <div><span>클래스 총수입</span><strong>{usd(report.class_gross_cents)}</strong><small>환불·세금·팁 제외</small></div>
          <div><span>강사 몫 · 70%</span><strong>{usd(report.class_instructor_cents)}</strong><small>내 매출 합계에서 제외</small></div>
          <div className={styles.ownerShare}><span>내 몫 · 30%</span><strong>{usd(report.class_owner_cents)}</strong><small>위 매출 합계에 포함</small></div>
        </div>
        <p className={styles.explanation}>수업일에 배정된 확인 수입을 강사 70%, 내 몫 30%로 나눕니다. 클래스 총수입이 $120이면 내 매출에는 $36만 반영합니다.</p>
      </section>
      <section className={styles.panel} aria-label="파티 매출 집계">
        <div className={styles.sectionHeading}><h2>파티일 기준 매출</h2><strong>{usd(report.party_cents)}</strong></div>
        {partyReviewCount > 0 && <p role="status" className={styles.warning}>파티 {partyReviewCount}건의 결제 확인이 필요합니다. 확인된 결제와 잔금만 표시합니다.</p>}
        <div className={styles.reconciliation}><span>미리 받은 디파짓·선결제 <strong>{usd(report.party_prepaid_cents)}</strong></span><span>영수증으로 확인된 잔금 <strong>{usd(report.party_due_cents)}</strong></span></div>
        <p className={styles.explanation}>디파짓과 잔금은 파티 날짜에 한 번만 매출로 반영합니다.</p>
        <details className={styles.method}><summary>선택일에 받은 파티 결제 {usd(report.party_received_today_cents)}</summary><p>수납 날짜를 확인하는 내역입니다. 위 매출에 다시 더하지 않습니다. 세금·팁·기프트카드 사용액 제외, 누적 환불 차감 전입니다.</p>
          {report.party_receipts.length > 0 ? <div className={styles.scroll}><table className={styles.table}><thead><tr><th>파티</th><th>파티 날짜</th><th>당일 수납</th><th>누적 환불</th></tr></thead><tbody>{report.party_receipts.map((payment, index) => <tr key={`${payment.service_id}:${payment.id}:${index}`}><td>{payment.label}{payment.review && <small className={styles.issue}>예약 또는 결제 확인 필요</small>}</td><td>{payment.service_date ?? '연결 필요'}</td><td>{usd(payment.received_cents)}</td><td>{usd(payment.refunded_cents)}</td></tr>)}</tbody></table></div> : <p>선택일의 파티 수납 내역이 없습니다.</p>}
        </details>
        {report.unallocated_party_cents > 0 && <p className={styles.warning}>파티 날짜 확인 필요 {usd(report.unallocated_party_cents)} · 매출 합계에서 제외했습니다.</p>}
      </section>
      {report.unallocated_class_cents > 0 && <p className={styles.warning}>수업일 연결 확인 필요 {usd(report.unallocated_class_cents)} · 매출 합계에서 제외했습니다.</p>}
      <div className={styles.reconciliation}><span>확인된 서비스 잔금 <strong>{usd(report.due_cents)}</strong></span><span>고객 환불 총액 <strong>{usd(report.refunded_cents)}</strong></span><span>서비스일 이후 받은 결제 <strong>{usd(report.later_paid_cents)}</strong></span><span>기프트카드 사용 · 중복 제외 <strong>{usd(report.redeemed_cents)}</strong></span></div>

      <details className={`${styles.panel} ${styles.method}`}><summary>결제·확인 대상 상세 · {detailRows.length}개 내역</summary>
        <p>각 행은 예약·입장 기록 또는 판매항목입니다. 추가 결제가 없는 동반 성인·멤버십 입장은 위 방문 인원에 포함합니다.</p>
        {!detailRows.length ? <p className={styles.empty}>선택일의 결제·확인 대상 내역이 없습니다.</p> : <div className={styles.scroll}><table className={styles.table}><thead><tr><th>출처·내역</th><th>방문·예약</th><th>확인 매출</th><th>잔금·확인 대상</th></tr></thead><tbody>{detailRows.map(row => <tr key={row.id}>
          <td><strong>{sourceLabel(row.id)} · {row.label}</strong>{row.issues.map(issue => <small className={styles.issue} key={issue}>{issueText(issue)}</small>)}{row.category === 'party' && row.payment_details.map(payment => <small key={payment.id}>{payment.date} 결제 {usd(payment.received_cents)}</small>)}{row.refunded_cents > 0 && <small>환불 {usd(row.refunded_cents)}</small>}</td>
          <td><span className={row.issues.length || row.payment_check ? styles.review : styles.badge}>{row.cancelled ? '취소' : row.attendance === 'sale' ? (row.category === 'open_play' ? '방문 연결 미확인' : '판매') : row.attendance === 'visited' ? '방문 확인' : '방문 미확인'}</span></td>
          <td>{['unallocated_class', 'unallocated_party'].includes(row.recognition ?? '') ? `${usd(row.received_cents - row.refunded_cents - row.redeemed_cents)} · 날짜 연결 대기` : row.issues.length ? '집계 제외' : row.payment_check && row.received_cents === 0 ? '결제 확인 필요' : <>{usd(row.net_cents)}{row.category === 'class' && row.gross_net_cents > 0 && <small>내 몫 30% · 총수입 {usd(row.gross_net_cents)}<br />강사 몫 {usd(row.instructor_share_cents)}</small>}</>}</td>
          <td>{row.pending_payment_cents > 0 ? <>{usd(row.pending_payment_cents)}<small>대조 대상 · 미수금 미확정</small></> : row.issues.length ? '개별 확인 필요' : row.due_cents > 0 ? <>{usd(row.due_cents)}<small>확인된 잔금</small></> : '—'}</td>
        </tr>)}</tbody></table></div>}
      </details>
      {!!report.issues.length && <section className={styles.warning}><h2>자료 확인 필요</h2><ul>{report.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></section>}
      <details className={styles.method}><summary>계산 기준</summary><p>매출은 실제 확인된 결제에서 환불을 뺀 금액이며, 클래스는 그중 내 몫 30%만 합산합니다. 클래스 총수입과 강사 몫 70%는 따로 표시합니다. 세금·팁을 제외하며 카드 수수료를 빼기 전 금액입니다. 입장은 예약·현장 입장을 한 항목으로 합산합니다. 결제와 방문 연결 여부는 입장 매출 아래에 구분합니다.</p><p>방문 인원은 선택일에 실제 체크인한 사람을 고유 ID로 한 번씩 셉니다. 아동·성인·구분 미확인 인원을 구분합니다. 예약 건수와 Square 판매항목 수는 방문 인원에 더하지 않습니다.</p><p>방문 미확인 예약이나 영수증이 연결되지 않은 미결제 기록은 결제 대조 대상으로 표시합니다. 방문이 확인되고 일부 결제가 영수증으로 검증된 입장만 남은 금액을 확정 잔금으로 표시합니다. 파티·수업의 확인된 청구 잔금과 고객 환불은 고객 기준 전체 금액으로 표시합니다. 선결제·당일 결제·서비스일 이후 결제에는 클래스 내 몫 30%만 포함합니다. 미결제 기록만으로 고객의 채무나 노쇼를 확정하지 않습니다.</p><p>예약 선결제와 파티 결제는 현재 서비스 날짜, 수업 시리즈는 각 회차에 배분합니다. 기프트카드는 구매 시 반영하고 사용 시 중복 합산하지 않습니다. 카페 등 기타 판매는 결제일에 반영합니다. 클래스 배분은 선택한 수업일의 총수입에 30%를 적용하고 센트 단위로 반올림한 뒤 상세 내역에 나눕니다. 예약일 변경·추가 결제·환불에 따라 과거 날짜도 갱신됩니다.</p></details>
      <p className={styles.updated}>마지막 확인: {new Date(report.generated_at).toLocaleString('ko-KR', { timeZone: 'America/New_York' })} (뉴욕)</p>
    </>}
  </main>;
}
