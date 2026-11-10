'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { safeAuthNextPath } from '@/lib/auth-redirect';
import { withAuthDeadline } from '@/lib/auth-request';
import styles from './login.module.css';

type AuthMethod = 'phone' | 'email';
type JourneyMode = 'new' | 'existing' | 'continue';
type Step = 'collect' | 'verify' | 'emailLinkSent';

const OTP_LENGTH = 4;
const TEXT_RESEND_SECONDS = 30;
const EMAIL_RESEND_SECONDS = 180;
const PRODUCTION_SITE_URL = 'https://thelittlewanderers.com';
const EMAIL_LINK_SENT_STORAGE_PREFIX = 'lw_email_link_sent_at';

const normalizeUsPhone = (input: string) => {
  const digits = input.replace(/\D/g, '');
  if (!digits) return '';

  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return `+1${local}`;
};

function formatAuthError(message: string, method: AuthMethod) {
  const normalized = message.toLowerCase();
  if (['auth_request_timeout', 'failed to fetch', 'fetch failed', 'networkerror', 'network request failed', 'load failed', 'timed out', 'timeout', 'aborted'].some(value => normalized.includes(value))) {
    return 'The sign-in service is not responding. Please wait a moment and try again.';
  }
  if (normalized.includes('missing-code')) {
    return 'That login link did not include a usable sign-in code. Please request a fresh email link and use the newest email.';
  }
  if (normalized.includes('signup') && (normalized.includes('disable') || normalized.includes('not allowed'))) {
    return 'Account creation is temporarily unavailable. Please try again later or contact Little Wanderers.';
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return method === 'email'
      ? 'Too many login link requests for this email. Please wait a few more minutes, then try again. If a recent email arrived, use the newest link.'
      : 'Too many text code requests. Please wait a few more minutes, then try again.';
  }
  if (normalized.includes('invalid') && normalized.includes('otp')) {
    return 'That code was not accepted. Please check the code and try again.';
  }
  if (normalized.includes('expired') || normalized.includes('invalid')) {
    return method === 'email'
      ? 'That login link expired or was already used. Please request a fresh email and open the newest link.'
      : 'That code expired or was not accepted. Please request a new code.';
  }
  return message || 'Something went wrong. Please try again.';
}

function getSafeNextPath() {
  return safeAuthNextPath(sessionStorage.getItem('post_login_redirect'), window.location.origin);
}

function getEmailRedirectTo(mode: JourneyMode) {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  const configuredIsLocal = configuredSiteUrl?.includes('localhost') || configuredSiteUrl?.includes('127.0.0.1');
  const currentIsLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const origin = mode === 'continue' && !currentIsLocal
    ? window.location.origin
    : configuredSiteUrl && !configuredIsLocal
    ? configuredSiteUrl
    : currentIsLocal
      ? PRODUCTION_SITE_URL
      : window.location.origin;
  const url = new URL('/auth/link', origin);
  url.searchParams.set('mode', mode);
  url.searchParams.set('next', getSafeNextPath());
  return url.toString();
}

function emailLinkStorageKey(email: string, mode: JourneyMode) {
  return `${EMAIL_LINK_SENT_STORAGE_PREFIX}:${mode}:${email}`;
}

function getRecentEmailLinkRemaining(email: string, mode: JourneyMode) {
  if (typeof window === 'undefined') return 0;
  let sentAt = 0;
  try {
    sentAt = Number(window.localStorage.getItem(emailLinkStorageKey(email, mode)) ?? 0);
  } catch {
    return 0;
  }
  if (!Number.isFinite(sentAt) || sentAt <= 0) return 0;
  const elapsedSeconds = Math.floor((Date.now() - sentAt) / 1000);
  return Math.max(EMAIL_RESEND_SECONDS - elapsedSeconds, 0);
}

function rememberEmailLinkSent(email: string, mode: JourneyMode) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(emailLinkStorageKey(email, mode), String(Date.now()));
  } catch {
    // Login should still work if browser storage is unavailable.
  }
}

export default function LoginPage() {
  const [ready, setReady] = useState(false);
  const [wanderlistEntry, setWanderlistEntry] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('email');
  const journeyMode: JourneyMode = 'continue';
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [step, setStep] = useState<Step>('collect');

  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [resendIn, setResendIn] = useState(0);

  const [pendingPhone, setPendingPhone] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [lastAutoSubmitToken, setLastAutoSubmitToken] = useState<string | null>(null);

  const firstInputRef = useRef<HTMLInputElement>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const requestInFlightRef = useRef(false);
  const verificationInFlightRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    const mode = params.get('mode');
    setWanderlistEntry(mode === 'continue' && next === '/wanderlist-founding');
    const authError = params.get('error');
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      sessionStorage.setItem('post_login_redirect', next);
    }
    if (authError) {
      setError(formatAuthError(authError, 'email'));
    }
    setReady(true);

    const redirectIfSignedIn = async () => {
      const supabase = createBrowserSupabaseClient();
      try {
        const { data } = await withAuthDeadline(() => supabase.auth.getUser());
        if (data.user) window.location.replace(getSafeNextPath());
      } catch {
        // A stalled session check must not block the sign-in form.
      }
    };

    void redirectIfSignedIn();
  }, []);

  useEffect(() => {
    if (step === 'collect') {
      firstInputRef.current?.focus();
    } else if (step === 'verify') {
      otpRefs.current[0]?.focus();
    }
  }, [step, authMethod]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setInterval(() => {
      setResendIn((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendIn]);

  const normalizedPhone = useMemo(() => normalizeUsPhone(phoneInput), [phoneInput]);
  const normalizedEmail = useMemo(() => emailInput.trim().toLowerCase(), [emailInput]);
  const otpToken = otpDigits.join('');

  const canRequestOtp = authMethod === 'phone'
    ? /^\+1\d{10}$/.test(normalizedPhone)
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);

  const clearFeedback = useCallback(() => {
    setError(null);
    setMessage(null);
  }, []);

  const requestOtp = async (reason: 'send' | 'resend') => {
    if (requestInFlightRef.current) return;
    clearFeedback();

    const supabase = createBrowserSupabaseClient();
    const shouldCreateUser = true;

    if (authMethod === 'email') {
      const remaining = getRecentEmailLinkRemaining(normalizedEmail, journeyMode);
      if (remaining > 0) {
        setPendingEmail(normalizedEmail);
        setStep('emailLinkSent');
        setResendIn(remaining);
        setMessage('We already sent a login link. Please open the newest email from Little Wanderers.');
        return;
      }
    }

    requestInFlightRef.current = true;
    setPending(true);

    let response;
    try {
      response = await withAuthDeadline(() => authMethod === 'phone'
        ? supabase.auth.signInWithOtp({
            phone: normalizedPhone,
            options: {
              shouldCreateUser,
              channel: 'sms',
            },
          })
        : supabase.auth.signInWithOtp({
            email: normalizedEmail,
            options: {
              shouldCreateUser,
              emailRedirectTo: getEmailRedirectTo(journeyMode),
            },
          }));
    } catch (error) {
      setError(formatAuthError(error instanceof Error ? error.message : 'network request failed', authMethod));
      return;
    } finally {
      requestInFlightRef.current = false;
      setPending(false);
    }

    if (response.error) {
      setError(formatAuthError(response.error.message, authMethod));
      return;
    }

    if (authMethod === 'phone') {
      setPendingPhone(normalizedPhone);
      setMessage(reason === 'send' ? 'We sent a 4-digit code by text.' : 'We sent a new code.');
      setStep('verify');
      setOtpDigits(Array(OTP_LENGTH).fill(''));
      setLastAutoSubmitToken(null);
    } else {
      setPendingEmail(normalizedEmail);
      rememberEmailLinkSent(normalizedEmail, journeyMode);
      sessionStorage.setItem('post_login_journey', journeyMode);
      setMessage(
        reason === 'send' ? 'Open the newest link in your email to continue.' : 'We sent a fresh login link. Please open the newest link.'
      );
      setStep('emailLinkSent');
    }

    setResendIn(authMethod === 'email' ? EMAIL_RESEND_SECONDS : TEXT_RESEND_SECONDS);
  };

  const verifyOtp = useCallback(async () => {
    if (verificationInFlightRef.current) return;
    clearFeedback();
    if (otpToken.length !== OTP_LENGTH) {
      setError(`Please enter the ${OTP_LENGTH}-digit code.`);
      return;
    }

    verificationInFlightRef.current = true;
    setLastAutoSubmitToken(otpToken);
    setPending(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const response = await withAuthDeadline(() => authMethod === 'phone'
        ? supabase.auth.verifyOtp({ phone: pendingPhone, token: otpToken, type: 'sms' })
        : supabase.auth.verifyOtp({ email: pendingEmail, token: otpToken, type: 'email' }));

      if (response.error) {
        setError(formatAuthError(response.error.message, authMethod));
        return;
      }

      const { data: { user }, error: userError } = await withAuthDeadline(() => supabase.auth.getUser());
      if (userError || !user) {
        setError(userError ? formatAuthError(userError.message, authMethod) : 'We could not finish signing you in. Please try again.');
        return;
      }

      const next = getSafeNextPath();
      sessionStorage.removeItem('post_login_redirect');
      window.location.replace(`/auth/finish?next=${encodeURIComponent(next)}`);
    } catch (error) {
      setError(formatAuthError(error instanceof Error ? error.message : 'network request failed', authMethod));
    } finally {
      verificationInFlightRef.current = false;
      setPending(false);
    }
  }, [authMethod, clearFeedback, otpToken, pendingEmail, pendingPhone]);

  const onOtpChange = (index: number, value: string) => {
    setLastAutoSubmitToken(null);
    const nextDigit = value.replace(/\D/g, '').slice(-1);
    const nextDigits = [...otpDigits];
    nextDigits[index] = nextDigit;
    setOtpDigits(nextDigits);

    if (nextDigit && index < OTP_LENGTH - 1) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const onOtpKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  useEffect(() => {
    if (step !== 'verify') return;
    if (otpToken.length !== OTP_LENGTH) return;
    if (pending) return;
    if (lastAutoSubmitToken === otpToken) return;

    setLastAutoSubmitToken(otpToken);
    void verifyOtp();
  }, [step, otpToken, pending, lastAutoSubmitToken, verifyOtp]);

  const switchToEmailFallback = () => {
    setAuthMethod('email');
    setStep('collect');
    clearFeedback();
  };

  if (!ready) return <main style={{ padding: 16, maxWidth: 480, margin: '0 auto' }}><p role="status">Preparing sign-in…</p></main>;

  return (
    <main className={styles.main}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Your little corner</p>
        <h1>Welcome to<br/>Little Wanderers.</h1>
        <p className={styles.intro}>{wanderlistEntry ? 'Use the email you joined the Wanderlist with. We’ll send a link to continue your $50 + $10 membership.' : 'Enter your email to sign in or create your free family account. No password to remember.'}</p>

        {wanderlistEntry && authMethod === 'phone' && <p style={{ fontSize: 13, lineHeight: 1.6, color: '#6b4d12', background: '#fff8e6', padding: 12, borderRadius: 12 }}>Use phone only if it is already verified on your Wanderlist account. First time here? Choose email to keep your $10 sibling rate.</p>}

        {step === 'collect' && authMethod === 'phone' && (
          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            <label htmlFor="phone" style={{ color: '#4f3f82', fontWeight: 600 }}>Phone number (US)</label>
            <input
              id="phone"
              disabled={pending}
              ref={firstInputRef}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="(555) 123-4567"
              value={phoneInput}
              onChange={(event) => setPhoneInput(event.target.value)}
              style={{ padding: '12px 14px', width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid #d8c5f6' }}
            />
            <button type="button" onClick={() => requestOtp('send')} disabled={!canRequestOtp || pending} style={{ marginTop: 4, padding: '12px 16px', borderRadius: 12, border: 'none', background: '#5f3da4', color: '#fff', fontWeight: 700 }}>
              {pending ? 'Sending…' : 'Text me a code'}
            </button>
          </div>
        )}

        {step === 'collect' && authMethod === 'email' && (
          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            <label htmlFor="email" style={{ color: '#4f3f82', fontWeight: 600 }}>Email address</label>
            <input
              id="email"
              disabled={pending}
              type="email"
              ref={firstInputRef}
              autoComplete="email"
              placeholder="you@example.com"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              style={{ padding: '12px 14px', width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid #d8c5f6' }}
            />
            <button type="button" onClick={() => requestOtp('send')} disabled={!canRequestOtp || pending} style={{ marginTop: 4, padding: '12px 16px', borderRadius: 12, border: 'none', background: '#5f3da4', color: '#fff', fontWeight: 700 }}>
              {pending ? 'Sending…' : 'Email me a login link'}
            </button>
          </div>
        )}

        {step === 'collect' && <button className={styles.alternative} disabled={pending} type="button" onClick={() => { setAuthMethod(authMethod === 'email' ? 'phone' : 'email'); clearFeedback(); }} style={{ display: 'block', width: '100%', marginTop: 12, padding: 10, background: 'transparent', border: 'none', color: '#79618f', textDecoration: 'underline', fontSize: 12, cursor: 'pointer' }}>{authMethod === 'email' ? 'Use a linked phone number instead' : 'Use email instead'}</button>}

        {step === 'emailLinkSent' && (
          <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
            <div style={{ borderRadius: 16, border: '1px solid #d6f0dc', background: '#f2fbf4', padding: 14 }}>
              <p style={{ margin: 0, color: '#2f7a47', fontWeight: 800 }}>Check your email</p>
              <p style={{ margin: '6px 0 0', color: '#4f3f82', lineHeight: 1.5 }}>
                Please head to your email for the login link we sent to <strong>{pendingEmail}</strong>.
                 Open it to {wanderlistEntry ? 'return directly to your membership' : 'continue where you left off'}.
              </p>
              <p style={{ margin: '8px 0 0', color: '#6b4d12', lineHeight: 1.5, fontWeight: 700 }}>
                If you requested more than one email, only the newest Little Wanderers link will work.
              </p>
            </div>

            <button type="button" disabled={resendIn > 0 || pending} onClick={() => requestOtp('resend')} style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 600 }}>
              {resendIn > 0 ? `Send a new link (${resendIn}s)` : 'Send a new link'}
            </button>

            <button type="button" disabled={pending} onClick={() => { setStep('collect'); clearFeedback(); }} style={{ padding: '10px 12px', borderRadius: 12, border: 'none', background: 'transparent', color: '#6d6480', fontWeight: 600 }}>
              Change email
            </button>
          </div>
        )}

        {step === 'verify' && (
          <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
            <p style={{ margin: 0, color: '#6d6480' }}>
              Enter the 4-digit code sent to {authMethod === 'phone' ? pendingPhone : pendingEmail}.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${OTP_LENGTH}, minmax(0, 1fr))`, gap: 8 }}>
              {otpDigits.map((digit, index) => (
                <input
                  key={`otp-${index}`}
                  disabled={pending}
                  ref={(element) => { otpRefs.current[index] = element; }}
                  value={digit}
                  onChange={(event) => onOtpChange(index, event.target.value)}
                  onKeyDown={(event) => onOtpKeyDown(index, event)}
                  inputMode="numeric"
                  maxLength={1}
                  style={{ textAlign: 'center', padding: '12px 0', fontSize: 20, borderRadius: 12, border: '1px solid #d8c5f6' }}
                />
              ))}
            </div>

            <button type="button" onClick={verifyOtp} disabled={pending || otpToken.length !== OTP_LENGTH} style={{ padding: '12px 16px', borderRadius: 12, border: 'none', background: '#5f3da4', color: '#fff', fontWeight: 700 }}>
              {pending ? 'Checking…' : 'Verify code (auto)'}
            </button>

            <button type="button" disabled={resendIn > 0 || pending} onClick={() => requestOtp('resend')} style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 600 }}>
              {resendIn > 0 ? `Resend code (${resendIn}s)` : 'Resend code'}
            </button>

            {authMethod === 'phone' && (
              <button type="button" onClick={switchToEmailFallback} disabled={pending} style={{ padding: '10px 12px', borderRadius: 12, border: 'none', background: 'transparent', color: '#5f3da4', textDecoration: 'underline', fontWeight: 600 }}>
                Did not get a text? Continue with email
              </button>
            )}

            <button type="button" disabled={pending} onClick={() => { setStep('collect'); clearFeedback(); }} style={{ padding: '10px 12px', borderRadius: 12, border: 'none', background: 'transparent', color: '#6d6480', fontWeight: 600 }}>
              Change phone or email
            </button>
          </div>
        )}

        {message && step !== 'emailLinkSent' && <p role="status" style={{ marginTop: 14, color: '#5f3da4' }}>{message}</p>}
        {error && <p role="alert" style={{ marginTop: 14, color: '#8a3f6b' }}>{error}</p>}
      </section>
    </main>
  );
}
