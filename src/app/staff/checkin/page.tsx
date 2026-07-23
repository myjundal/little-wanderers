'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Html5QrcodeScanner } from 'html5-qrcode';

type LineItem = {
  id: string;
  name: string;
  quantity: number;
  price_cents: number;
};

type Household = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
};

type Candidate = {
  person_id: string;
  household_id: string;
  first_name: string | null;
  last_name: string | null;
  role: 'adult' | 'child';
  birthdate: string | null;
  membership_applied: boolean;
  price_cents: number;
  lineItems: LineItem[];
  household: Household | null;
};

type PreviewResponse = {
  ok: boolean;
  candidate?: Candidate | null;
  error?: string;
};

type RecentVisit = {
  session_id: string;
  count: number;
  paid_cents: number;
  paymentLabel: string;
  completedAt: string;
};

type PaymentStatus = 'prepaid' | 'walkin_paid' | 'square_pos_paid' | 'membership';

type PendingSquarePosSession = {
  session_id: string;
  candidates: Candidate[];
  total_price_cents: number;
};

type SquarePosResult = {
  ok: boolean;
  state: string | null;
  transaction_id: string | null;
  client_transaction_id: string | null;
  error: string | null;
};

const POS_PENDING_STORAGE_KEY = 'lw_staff_checkin_square_pos_pending';

const navLinkStyle: React.CSSProperties = {
  borderRadius: 8,
  border: '1px solid #d9c8f7',
  padding: '10px 14px',
  color: '#5f3da4',
  textDecoration: 'none',
  fontWeight: 700,
  background: '#fff',
};

const buttonStyle: React.CSSProperties = {
  minHeight: 44,
  border: 0,
  borderRadius: 8,
  padding: '10px 14px',
  fontWeight: 800,
  cursor: 'pointer',
};

function extractPersonId(text: string): string | null {
  const lw = text.match(/lw:\/\/person\/([0-9a-fA-F-]{36})/);
  if (lw?.[1]) return lw[1];
  const uuid = text.match(/[0-9a-fA-F-]{8}-[0-9a-fA-F-]{4}-[1-5][0-9a-fA-F-]{3}-[89abAB][0-9a-fA-F-]{3}-[0-9a-fA-F-]{12}/);
  return uuid?.[0] ?? null;
}

function formatMoney(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatName(person: Candidate) {
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim() || 'Guest';
}

function isBirthdayToday(birthdate: string | null): boolean {
  if (!birthdate) return false;
  const [year, month, day] = birthdate.split('-').map(Number);
  if (!year || !month || !day) return false;
  const today = new Date();
  return today.getDate() === day && today.getMonth() + 1 === month;
}

function paymentLabel(status: PaymentStatus) {
  switch (status) {
    case 'prepaid':
      return 'Online prepaid';
    case 'square_pos_paid':
      return 'Square POS';
    case 'walkin_paid':
      return 'Paid at iPad stand';
    case 'membership':
      return 'Membership / included';
  }
}

function readSquarePosResult(params: URLSearchParams): SquarePosResult | null {
  const iosData = params.get('data');
  if (iosData) {
    try {
      const parsed = JSON.parse(iosData) as {
        status?: string;
        state?: string;
        transaction_id?: string;
        client_transaction_id?: string;
        error_code?: string;
        error_description?: string;
      };
      return {
        ok: parsed.status === 'ok',
        state: parsed.state ?? null,
        transaction_id: parsed.transaction_id ?? null,
        client_transaction_id: parsed.client_transaction_id ?? null,
        error: parsed.error_description ?? parsed.error_code ?? null,
      };
    } catch {
      return { ok: false, state: null, transaction_id: null, client_transaction_id: null, error: 'Invalid Square POS response' };
    }
  }

  const androidError = params.get('com.squareup.pos.ERROR_CODE');
  const androidTransactionId = params.get('com.squareup.pos.SERVER_TRANSACTION_ID');
  const androidClientTransactionId = params.get('com.squareup.pos.CLIENT_TRANSACTION_ID');
  const androidState = params.get('com.squareup.pos.REQUEST_METADATA');
  if (androidError || androidTransactionId || androidClientTransactionId) {
    return {
      ok: Boolean(androidTransactionId || androidClientTransactionId) && !androidError,
      state: androidState,
      transaction_id: androidTransactionId,
      client_transaction_id: androidClientTransactionId,
      error: params.get('com.squareup.pos.ERROR_DESCRIPTION') ?? androidError,
    };
  }

  return null;
}

function buildSquarePosUrl(totalCents: number, sessionId: string, guestCount: number) {
  const clientId = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID?.trim();
  if (!clientId) throw new Error('NEXT_PUBLIC_SQUARE_APPLICATION_ID is required for Square POS');

  const callbackUrl = new URL('/staff/checkin', window.location.origin);
  callbackUrl.searchParams.set('square_pos_return', '1');

  const version = process.env.NEXT_PUBLIC_SQUARE_POS_API_VERSION?.trim() || '1.3';
  const note = `Little Wanderers check-in (${guestCount} guest${guestCount === 1 ? '' : 's'})`;
  const isAppleMobile =
    /iPad|iPhone|iPod/.test(window.navigator.userAgent) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);

  if (isAppleMobile) {
    const data = {
      amount_money: {
        amount: totalCents,
        currency_code: 'USD',
      },
      callback_url: callbackUrl.toString(),
      client_id: clientId,
      version,
      state: sessionId,
      notes: note,
      options: {
        supported_tender_types: ['CREDIT_CARD', 'CASH', 'OTHER'],
        auto_return: true,
        skip_receipt: false,
      },
    };
    return `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify(data))}`;
  }

  const androidValue = (value: string) => encodeURIComponent(value).replace(/%20/g, '+');
  return [
    'intent:#Intent',
    'action=com.squareup.pos.action.CHARGE',
    'package=com.squareup',
    `S.browser_fallback_url=${androidValue(callbackUrl.toString())}`,
    `S.com.squareup.pos.WEB_CALLBACK_URI=${androidValue(callbackUrl.toString())}`,
    `S.com.squareup.pos.CLIENT_ID=${androidValue(clientId)}`,
    'S.com.squareup.pos.API_VERSION=v2.0',
    `i.com.squareup.pos.TOTAL_AMOUNT=${totalCents}`,
    'S.com.squareup.pos.CURRENCY_CODE=USD',
    'S.com.squareup.pos.TENDER_TYPES=com.squareup.pos.TENDER_CARD,com.squareup.pos.TENDER_CASH,com.squareup.pos.TENDER_OTHER',
    `S.com.squareup.pos.NOTE=${androidValue(note)}`,
    `S.com.squareup.pos.REQUEST_METADATA=${androidValue(sessionId)}`,
    'end',
  ].join(';');
}

export default function StaffCheckinPage() {
  const [lastScan, setLastScan] = useState('');
  const [message, setMessage] = useState('Ready to scan.');
  const [scanned, setScanned] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [recentVisits, setRecentVisits] = useState<RecentVisit[]>([]);

  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const lastScanTimeRef = useRef(0);
  const startedRef = useRef(false);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const scannedRef = useRef<Candidate[]>([]);
  const busyRef = useRef(false);

  useEffect(() => {
    scannedRef.current = scanned;
  }, [scanned]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const resetSession = useCallback((nextMessage = 'Ready for the next family.') => {
    setScanned([]);
    scannedRef.current = [];
    setLastScan('');
    setMessage(nextMessage);
    sessionIdRef.current = crypto.randomUUID();
  }, []);

  const finalizeVisit = useCallback(
    async (paymentStatus: PaymentStatus, squarePosResult?: Pick<SquarePosResult, 'transaction_id' | 'client_transaction_id'>) => {
      const currentScans = scannedRef.current;
      if (currentScans.length === 0) {
        setMessage('Scan at least one guest before completing entry.');
        return;
      }

      setBusy(true);
      setMessage('Recording check-in...');

      try {
        const res = await fetch('/api/checkin', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: 'finalize',
            person_ids: currentScans.map((item) => item.person_id),
            source: 'qr_staff_session',
            payment_status: paymentStatus,
            session_id: sessionIdRef.current,
            square_pos_transaction_id: squarePosResult?.transaction_id ?? null,
            square_pos_client_transaction_id: squarePosResult?.client_transaction_id ?? null,
          }),
        });

        const data = await res.json();
        if (!data.ok) {
          setMessage(data.error ?? 'Could not record check-in.');
          return;
        }

        const paidCents = paymentStatus === 'membership' ? 0 : totalDueRef(currentScans);
        setRecentVisits((prev) => [
          {
            session_id: data.session_id ?? sessionIdRef.current,
            count: currentScans.length,
            paid_cents: paidCents,
            paymentLabel: paymentLabel(paymentStatus),
            completedAt: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          },
          ...prev,
        ].slice(0, 5));

        resetSession(`Entry complete for ${currentScans.length} guest${currentScans.length === 1 ? '' : 's'}.`);
      } catch {
        setMessage('Network error while recording check-in.');
      } finally {
        setBusy(false);
      }
    },
    [resetSession]
  );

  useEffect(() => {
    const result = readSquarePosResult(new URLSearchParams(window.location.search));
    if (!result) return;

    const rawPending = window.localStorage.getItem(POS_PENDING_STORAGE_KEY);
    const cleanUrl = () => window.history.replaceState({}, '', '/staff/checkin');

    if (!rawPending) {
      setMessage(result.error ?? 'Square POS returned, but no pending check-in session was found.');
      cleanUrl();
      return;
    }

    const pending = JSON.parse(rawPending) as PendingSquarePosSession;
    if (result.state && result.state !== pending.session_id) {
      setMessage('Square POS returned for a different check-in session.');
      cleanUrl();
      return;
    }

    window.localStorage.removeItem(POS_PENDING_STORAGE_KEY);
    sessionIdRef.current = pending.session_id;
    scannedRef.current = pending.candidates;
    setScanned(pending.candidates);
    cleanUrl();

    if (!result.ok) {
      setMessage(result.error ?? 'Square POS payment was canceled or failed.');
      return;
    }

    setMessage('Square POS payment completed. Recording entry...');
    void finalizeVisit('square_pos_paid', result);
  }, [finalizeVisit]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const el = document.getElementById('qr-reader');
    if (el) el.innerHTML = '';

    const scanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 250 }, false);

    scanner.render(async (decodedText) => {
      const now = Date.now();
      if (now - lastScanTimeRef.current < 1400 || busyRef.current) return;
      lastScanTimeRef.current = now;

      setLastScan(decodedText);

      const personId = extractPersonId(decodedText);
      if (!personId) {
        setMessage('That QR code is not a Little Wanderers guest code.');
        return;
      }

      if (scannedRef.current.some((item) => item.person_id === personId)) {
        setMessage('Already scanned for this entry.');
        return;
      }

      try {
        setBusy(true);
        setMessage('Reading family information...');
        const res = await fetch('/api/checkin', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: 'preview', person_id: personId }),
        });
        const data = (await res.json()) as PreviewResponse;

        if (!data.ok || !data.candidate) {
          setMessage(data.error ?? 'Could not read this QR code.');
          return;
        }

        setScanned((prev) => [...prev, data.candidate as Candidate]);
        setMessage(`${formatName(data.candidate)} added. Scan the next guest or complete entry.`);
      } catch {
        setMessage('Network error while reading QR code.');
      } finally {
        setBusy(false);
      }
    }, () => {
      // Scanner misses are noisy while the camera is open, so the UI stays quiet.
    });

    scannerRef.current = scanner;

    return () => {
      scanner.clear().catch(() => {});
      startedRef.current = false;
      scannerRef.current = null;
    };
  }, []);

  const primaryHousehold = scanned[0]?.household ?? null;
  const householdMismatch = useMemo(() => {
    if (scanned.length < 2) return false;
    const firstHouseholdId = scanned[0]?.household_id;
    return scanned.some((item) => item.household_id !== firstHouseholdId);
  }, [scanned]);

  const totalDue = useMemo(() => totalDueRef(scanned), [scanned]);
  const chargeableCount = scanned.filter((item) => !item.membership_applied && item.price_cents > 0).length;
  const allIncluded = scanned.length > 0 && chargeableCount === 0;

  const openSquarePosCheckout = () => {
    if (scanned.length === 0 || totalDue <= 0) return;

    try {
      window.localStorage.setItem(POS_PENDING_STORAGE_KEY, JSON.stringify({
        session_id: sessionIdRef.current,
        candidates: scanned,
        total_price_cents: totalDue,
      } satisfies PendingSquarePosSession));
      window.location.href = buildSquarePosUrl(totalDue, sessionIdRef.current, scanned.length);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not open Square POS.';
      setMessage(message);
    }
  };

  return (
    <main style={{ minHeight: '100vh', background: '#f8f5ff', padding: 20 }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 16 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0, color: '#2f2354', fontSize: 30 }}>Staff Check-in</h1>
            <p style={{ margin: '6px 0 0', color: '#6d6480' }}>Scan each guest, confirm payment coverage, then complete entry.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/" style={navLinkStyle}>Homepage</Link>
            <Link href="/landing" style={navLinkStyle}>Dashboard</Link>
            <Link href="/staff" style={navLinkStyle}>Staff Tools</Link>
          </div>
        </header>

        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ background: '#fff', border: '1px solid #e6ddf7', borderRadius: 8, padding: 14 }}>
            <div id="qr-reader" style={{ width: '100%' }} />
            <div style={{ marginTop: 12, fontSize: 13, color: '#6d6480', wordBreak: 'break-all' }}>
              <strong>Last scan:</strong> {lastScan || '-'}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ background: '#fff', border: '1px solid #e6ddf7', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0, color: '#2f2354', fontSize: 22 }}>Current Entry</h2>
                  <p style={{ margin: '6px 0 0', color: '#6d6480' }}>{message}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#6d6480', fontSize: 13 }}>Guests</div>
                  <div style={{ color: '#2f2354', fontSize: 28, fontWeight: 900 }}>{scanned.length}</div>
                </div>
              </div>

              {primaryHousehold && (
                <div style={{ marginTop: 14, padding: 12, background: '#fbf9ff', border: '1px solid #eee6fb', borderRadius: 8 }}>
                  <div style={{ fontWeight: 900, color: '#3f2f68' }}>{primaryHousehold.name || 'Family'}</div>
                  <div style={{ color: '#6d6480', marginTop: 4 }}>
                    {[primaryHousehold.email, primaryHousehold.phone].filter(Boolean).join('  |  ') || 'No contact details saved'}
                  </div>
                  {householdMismatch && (
                    <div style={{ marginTop: 8, color: '#a15d00', fontWeight: 800 }}>
                      Multiple households are in this entry session.
                    </div>
                  )}
                </div>
              )}

              {scanned.length === 0 ? (
                <div style={{ marginTop: 18, border: '1px dashed #cbb9ec', borderRadius: 8, padding: 18, color: '#6d6480' }}>
                  Waiting for the first QR code.
                </div>
              ) : (
                <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
                  {scanned.map((guest) => (
                    <div key={guest.person_id} style={{ border: '1px solid #e8e0f5', borderRadius: 8, padding: 12, background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
                        <div>
                          <div style={{ color: '#2f2354', fontWeight: 900 }}>
                            {formatName(guest)} <span style={{ color: '#7f719f', fontWeight: 700 }}>({guest.role})</span>
                          </div>
                          {isBirthdayToday(guest.birthdate) && (
                            <div style={{ color: '#2f7a47', fontWeight: 800, marginTop: 4 }}>Birthday visit today</div>
                          )}
                          <div style={{ marginTop: 8, color: '#6d6480' }}>
                            {guest.membership_applied ? 'Membership covers admission' : 'Walk-in admission'}
                          </div>
                        </div>
                        <div style={{ fontWeight: 900, color: guest.membership_applied ? '#2f7a47' : '#2f2354' }}>
                          {guest.membership_applied ? 'Covered' : formatMoney(guest.price_cents)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: '#fff', border: '1px solid #e6ddf7', borderRadius: 8, padding: 16 }}>
              <h2 style={{ margin: 0, color: '#2f2354', fontSize: 20 }}>Square Payment</h2>
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                {scanned.flatMap((guest) => guest.lineItems).map((item) => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: '#4f4568' }}>
                    <span>{item.name} x {item.quantity}</span>
                    <strong>{formatMoney(item.price_cents * item.quantity)}</strong>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #eee6fb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ color: '#6d6480' }}>Amount due now</div>
                </div>
                <div style={{ color: '#2f2354', fontSize: 28, fontWeight: 900 }}>{formatMoney(totalDue)}</div>
              </div>

              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                <button
                  type="button"
                  onClick={openSquarePosCheckout}
                  disabled={busy || scanned.length === 0 || totalDue <= 0}
                  style={{ ...buttonStyle, background: '#5f3da4', color: '#fff', opacity: busy || scanned.length === 0 || totalDue <= 0 ? 0.55 : 1 }}
                >
                  Open Square POS
                </button>
                <button
                  type="button"
                  onClick={() => finalizeVisit('walkin_paid')}
                  disabled={busy || scanned.length === 0 || totalDue <= 0}
                  style={{ ...buttonStyle, background: '#e9defa', color: '#4f2d8c', opacity: busy || scanned.length === 0 || totalDue <= 0 ? 0.55 : 1 }}
                >
                  Paid at iPad Stand
                </button>
                <button
                  type="button"
                  onClick={() => finalizeVisit('prepaid')}
                  disabled={busy || scanned.length === 0 || totalDue <= 0}
                  style={{ ...buttonStyle, background: '#e8f3ec', color: '#2f6f43', opacity: busy || scanned.length === 0 || totalDue <= 0 ? 0.55 : 1 }}
                >
                  Online Prepaid
                </button>
                <button
                  type="button"
                  onClick={() => finalizeVisit('membership')}
                  disabled={busy || !allIncluded}
                  style={{ ...buttonStyle, background: '#f4f1f9', color: '#3f345b', opacity: busy || !allIncluded ? 0.55 : 1 }}
                >
                  Complete Included Entry
                </button>
              </div>

              {scanned.length > 0 && (
                <button
                  type="button"
                  onClick={() => resetSession('Entry cleared. Ready to scan again.')}
                  disabled={busy}
                  style={{ marginTop: 12, border: '1px solid #dbcdf2', background: '#fff', color: '#5f3da4', borderRadius: 8, padding: '9px 12px', fontWeight: 800 }}
                >
                  Clear Current Entry
                </button>
              )}
            </div>

            {recentVisits.length > 0 && (
              <div style={{ background: '#fff', border: '1px solid #e6ddf7', borderRadius: 8, padding: 16 }}>
                <h2 style={{ margin: 0, color: '#2f2354', fontSize: 20 }}>Recent Completed Entries</h2>
                <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                  {recentVisits.map((visit) => (
                    <div key={visit.session_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: '#4f4568' }}>
                      <span>{visit.completedAt} - {visit.count} guest{visit.count === 1 ? '' : 's'} - {visit.paymentLabel}</span>
                      <strong>{formatMoney(visit.paid_cents)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function totalDueRef(items: Candidate[]) {
  return items.reduce((sum, item) => {
    if (item.membership_applied) return sum;
    return sum + item.price_cents;
  }, 0);
}
