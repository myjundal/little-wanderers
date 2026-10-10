'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

type AuthMethod = 'phone' | 'email';
type JourneyMode = 'new' | 'existing';
type Step = 'collect' | 'verify';

const PHONE_OTP_LENGTH = 4;
const EMAIL_OTP_LENGTH = 6;
const TEXT_RESEND_SECONDS = 30;
const EMAIL_RESEND_SECONDS = 120;
const PRODUCTION_SITE_URL = 'https://thelittlewanderers.com';

const normalizeUsPhone = (input: string) => {
  const digits = input.replace(/\D/g, '');
  if (!digits) return '';

  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return `+1${local}`;
};

function formatAuthError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('missing-code')) {
    return 'That login link did not include a usable sign-in code. Please request a fresh email link and use the newest email.';
  }
  if (normalized.includes('signup') && (normalized.includes('disable') || normalized.includes('not allowed'))) {
    return 'We cannot create an account right now. Please contact Little Wanderers for help.';
  }
  if (normalized.includes('rate limit') || normalized.includes('too many')) {
    return 'Too many code requests. Please wait a few minutes before requesting another code. Use the newest email or text if it has arrived.';
  }
  if (normalized.includes('invalid') && normalized.includes('otp')) {
    return 'That code was not accepted. Use the code in the newest email or text, or request a new code.';
  }
  if (normalized.includes('expired') || normalized.includes('invalid')) {
    return 'That code expired or was not accepted. Use the newest code or request a new one.';
  }
  return message || 'Something went wrong. Please try again.';
}

function getSafeNextPath() {
  const next = sessionStorage.getItem('post_login_redirect') || '/landing';
  if (!next.startsWith('/') || next.startsWith('//')) return '/landing';
  return next;
}

function getEmailRedirectTo(mode: JourneyMode) {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  const configuredIsLocal = configuredSiteUrl?.includes('localhost') || configuredSiteUrl?.includes('127.0.0.1');
  const currentIsLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const origin = configuredSiteUrl && !configuredIsLocal
    ? configuredSiteUrl
    : currentIsLocal
      ? PRODUCTION_SITE_URL
      : window.location.origin;
  const url = new URL('/auth/link', origin);
  url.searchParams.set('mode', mode);
  url.searchParams.set('next', getSafeNextPath());
  return url.toString();
}

export default function LoginPage() {
  const [authMethod, setAuthMethod] = useState<AuthMethod>('email');
  const [journeyMode, setJourneyMode] = useState<JourneyMode>('new');
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [step, setStep] = useState<Step>('collect');

  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWaitlistInvite, setShowWaitlistInvite] = useState(false);
  const [otpToken, setOtpToken] = useState('');
  const [resendIn, setResendIn] = useState(0);

  const [pendingPhone, setPendingPhone] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const requestInFlight = useRef(false);
  const verifyInFlight = useRef(false);
  const cooldownUntil = useRef(0);

  const firstInputRef = useRef<HTMLInputElement>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedCooldown = Number(sessionStorage.getItem('auth_resend_until') || 0);
    if (savedCooldown > Date.now()) {
      cooldownUntil.current = savedCooldown;
      setResendIn(Math.ceil((savedCooldown - Date.now()) / 1000));
    }
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    const mode = params.get('mode');
    const authError = params.get('error');
    if (next && next.startsWith('/') && !next.startsWith('//')) {
      sessionStorage.setItem('post_login_redirect', next);
    }
    if (authError) {
      setError(formatAuthError(authError));
    }
    if (mode === 'new' || mode === 'existing') {
      setJourneyMode(mode);
      setAuthMethod('email');
    }

    const redirectIfSignedIn = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      window.location.replace(getSafeNextPath());
    };

    void redirectIfSignedIn();
  }, []);

  useEffect(() => {
    if (step === 'collect') {
      firstInputRef.current?.focus();
    } else if (step === 'verify') {
      otpInputRef.current?.focus();
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
  const otpLength = authMethod === 'email' ? EMAIL_OTP_LENGTH : PHONE_OTP_LENGTH;

  const canRequestOtp = authMethod === 'phone'
    ? /^\+1\d{10}$/.test(normalizedPhone)
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);

  const clearFeedback = useCallback(() => {
    setError(null);
    setMessage(null);
    setShowWaitlistInvite(false);
  }, []);

  const requestOtp = async (reason: 'send' | 'resend') => {
    if (requestInFlight.current || verifyInFlight.current || !canRequestOtp || Date.now() < cooldownUntil.current) return;
    clearFeedback();

    const supabase = createBrowserSupabaseClient();
    const shouldCreateUser = journeyMode === 'new';

    if (shouldCreateUser && authMethod === 'phone') {
      setShowWaitlistInvite(true);
      setError('Please use email to create your account. You can add a phone number after signing in.');
      return;
    }

    requestInFlight.current = true;
    setPending(true);
    try {

      if (shouldCreateUser && authMethod === 'email') {
        try {
          const checkRes = await fetch('/api/waitlist/check', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: normalizedEmail }),
          });
          const checkJson = (await checkRes.json()) as { allowed?: boolean; claimed?: boolean; error?: string };

          if (!checkRes.ok || !checkJson.allowed) {
            setError(
              checkJson.error ||
              'We could not create your Little Wanderers access right now. Please try again soon.'
            );
            return;
          }
        } catch {
          setError('Unable to prepare Little Wanderers access right now. Please try again soon.');
          return;
        }
      }

      const response = authMethod === 'phone'
        ? await supabase.auth.signInWithOtp({
            phone: normalizedPhone,
            options: {
              shouldCreateUser,
              channel: 'sms',
            },
          })
        : await supabase.auth.signInWithOtp({
            email: normalizedEmail,
            options: {
              shouldCreateUser,
              emailRedirectTo: getEmailRedirectTo(journeyMode),
            },
          });


      if (response.error) {
        const safeError = response.error.message.toLowerCase();
        if (!shouldCreateUser && safeError.includes('not found')) {
          setError('We could not find an account for this email. If you are new, choose “I am new” first.');
          return;
        }
        setError(formatAuthError(response.error.message));
        return;
      }

      if (authMethod === 'phone') {
        setPendingPhone(normalizedPhone);
        setMessage(reason === 'send' ? 'We sent a 4-digit code by text.' : 'We sent a new code.');
        setStep('verify');
        setOtpToken('');
      } else {
        setPendingEmail(normalizedEmail);
        sessionStorage.setItem('post_login_journey', journeyMode);
        setMessage(
          reason === 'send'
            ? 'We sent a 6-digit code. Enter it here to sign in.'
            : 'We sent a new code. Use the code in the newest email.'
        );
        setOtpToken('');
        setStep('verify');
      }

      const cooldown = authMethod === 'email' ? EMAIL_RESEND_SECONDS : TEXT_RESEND_SECONDS;
      cooldownUntil.current = Date.now() + cooldown * 1000;
      sessionStorage.setItem('auth_resend_until', String(cooldownUntil.current));
      setResendIn(cooldown);
    } catch {
      setError('Unable to send your code right now. Please try again.');
    } finally {
      requestInFlight.current = false;
      setPending(false);
    }
  };

  const verifyOtp = useCallback(async () => {
    if (verifyInFlight.current || requestInFlight.current) return;
    clearFeedback();
    if (otpToken.length !== otpLength) {
      setError(`Please enter the ${otpLength}-digit code.`);
      return;
    }

    verifyInFlight.current = true;
    setPending(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const response = authMethod === 'phone'
        ? await supabase.auth.verifyOtp({
            phone: pendingPhone,
            token: otpToken,
            type: 'sms',
          })
        : await supabase.auth.verifyOtp({
            email: pendingEmail,
            token: otpToken,
            type: 'email',
          });


      if (response.error) {
        setError(formatAuthError(response.error.message));
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setError('We could not finish signing you in. Please try again.');
        return;
      }

      const next = getSafeNextPath();
      sessionStorage.removeItem('post_login_redirect');

      if (journeyMode === 'new') {
        await fetch('/api/waitlist/claim', { method: 'POST' }).catch(() => null);
        window.location.replace(next);
        return;
      }

      window.location.replace(next);
    } catch {
      setError('Unable to finish signing you in. Please try again.');
    } finally {
      verifyInFlight.current = false;
      setPending(false);
    }
  }, [authMethod, clearFeedback, journeyMode, otpToken, otpLength, pendingEmail, pendingPhone]);

  const switchToEmailFallback = () => {
    setAuthMethod('email');
    setStep('collect');
    clearFeedback();
  };

  return (
    <main style={{ padding: 16, maxWidth: 480, margin: '0 auto' }}>
      <section style={{ borderRadius: 24, border: '1px solid #e3d0fb', background: '#fff', boxShadow: '0 16px 28px rgba(120,87,177,0.12)', padding: 20 }}>
        <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Little Wanderers</p>
        <h1 style={{ margin: '10px 0 8px', color: '#4f3f82', fontSize: 26 }}>Sign in</h1>
        <p style={{ color: '#6d6480', lineHeight: 1.5, marginTop: 0 }}>Create or continue your Little Wanderers account with email.</p>

        <div style={{ marginTop: 16, width: '100%', boxSizing: 'border-box', overflow: 'hidden', overflowWrap: 'break-word', borderRadius: 16, border: '1px solid #f0d89b', background: '#fff8e6', padding: 14 }}>
          <p style={{ margin: 0, color: '#6b4d12', fontWeight: 800 }}>Early access now starts here.</p>
          <p style={{ margin: '6px 0 0', color: '#6d6480', lineHeight: 1.45 }}>
            Choose <strong style={{ color: '#4f3f82' }}>I am new</strong>, then <strong style={{ color: '#4f3f82' }}>Continue with email</strong>. If your email is not on the Wanderlist yet, we will add it and send a sign-in code.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
          <label style={{ color: '#4f3f82', fontWeight: 600 }}>Account status</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" disabled={pending} onClick={() => { setJourneyMode('existing'); setStep('collect'); clearFeedback(); }} style={{ padding: '10px 12px', borderRadius: 12, border: journeyMode === 'existing' ? '2px solid #5f3da4' : '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 600 }}>I already have an account</button>
            <button type="button" disabled={pending} onClick={() => { setJourneyMode('new'); setAuthMethod('email'); setStep('collect'); clearFeedback(); }} style={{ padding: '10px 12px', borderRadius: 12, border: journeyMode === 'new' ? '2px solid #5f3da4' : '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 600 }}>I am new</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
          <button type="button" disabled={pending} onClick={() => { setAuthMethod('phone'); setStep('collect'); clearFeedback(); }} style={{ padding: '11px 12px', borderRadius: 12, border: authMethod === 'phone' ? '2px solid #5f3da4' : '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 700 }}>Continue with phone</button>
          <button type="button" disabled={pending} onClick={() => { setAuthMethod('email'); setStep('collect'); clearFeedback(); }} style={{ padding: '11px 12px', borderRadius: 12, border: authMethod === 'email' ? '2px solid #5f3da4' : '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 700 }}>Continue with email</button>
        </div>

        {step === 'collect' && authMethod === 'phone' && (
          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            <label htmlFor="phone" style={{ color: '#4f3f82', fontWeight: 600 }}>Phone number (US)</label>
            <input
              id="phone"
              ref={firstInputRef}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="(555) 123-4567"
              value={phoneInput}
              onChange={(event) => setPhoneInput(event.target.value)}
              style={{ padding: '12px 14px', width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid #d8c5f6' }}
            />
            <button type="button" onClick={() => requestOtp('send')} disabled={!canRequestOtp || pending || resendIn > 0} style={{ marginTop: 4, padding: '12px 16px', borderRadius: 12, border: 'none', background: '#5f3da4', color: '#fff', fontWeight: 700 }}>
              {pending ? 'Sending…' : resendIn > 0 ? `Send code (${resendIn}s)` : 'Text me a code'}
            </button>
          </div>
        )}

        {step === 'collect' && authMethod === 'email' && (
          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            <label htmlFor="email" style={{ color: '#4f3f82', fontWeight: 600 }}>Email address</label>
            <input
              id="email"
              type="email"
              ref={firstInputRef}
              autoComplete="email"
              placeholder="you@example.com"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              style={{ padding: '12px 14px', width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid #d8c5f6' }}
            />
            <button type="button" onClick={() => requestOtp('send')} disabled={!canRequestOtp || pending || resendIn > 0} style={{ marginTop: 4, padding: '12px 16px', borderRadius: 12, border: 'none', background: '#5f3da4', color: '#fff', fontWeight: 700 }}>
              {pending ? 'Sending…' : resendIn > 0 ? `Send code (${resendIn}s)` : 'Email me a sign-in code'}
            </button>
          </div>
        )}

        {step === 'verify' && (
          <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
            <p style={{ margin: 0, color: '#6d6480' }}>
              Enter the {otpLength}-digit code sent to {authMethod === 'phone' ? pendingPhone : pendingEmail}.
            </p>
            <label htmlFor="sign-in-code" style={{ color: '#4f3f82', fontWeight: 600 }}>Sign-in code</label>
            <input
              id="sign-in-code"
              ref={otpInputRef}
              value={otpToken}
              onChange={(event) => setOtpToken(event.target.value.replace(/\D/g, '').slice(0, otpLength))}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void verifyOtp(); } }}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={otpLength}
              disabled={pending}
              style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', padding: 12, fontSize: 24, letterSpacing: '0.25em', borderRadius: 12, border: '1px solid #d8c5f6' }}
            />

            <button type="button" onClick={verifyOtp} disabled={pending || otpToken.length !== otpLength} style={{ padding: '12px 16px', borderRadius: 12, border: 'none', background: '#5f3da4', color: '#fff', fontWeight: 700 }}>
              {pending ? 'Checking…' : 'Sign in'}
            </button>

            <button type="button" disabled={resendIn > 0 || pending} onClick={() => requestOtp('resend')} style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 600 }}>
              {resendIn > 0 ? `Resend code (${resendIn}s)` : 'Resend code'}
            </button>

            {authMethod === 'phone' && (
              <button type="button" disabled={pending} onClick={switchToEmailFallback} style={{ padding: '10px 12px', borderRadius: 12, border: 'none', background: 'transparent', color: '#5f3da4', textDecoration: 'underline', fontWeight: 600 }}>
                Did not get a text? Continue with email
              </button>
            )}

            <button type="button" disabled={pending} onClick={() => { setStep('collect'); clearFeedback(); }} style={{ padding: '10px 12px', borderRadius: 12, border: 'none', background: 'transparent', color: '#6d6480', fontWeight: 600 }}>
              Change phone or email
            </button>
          </div>
        )}

        {message && <p role="status" style={{ marginTop: 14, color: '#5f3da4' }}>{message}</p>}
        {error && <p role="alert" style={{ marginTop: 14, color: '#8a3f6b' }}>{error}</p>}
        {showWaitlistInvite && (
          <p style={{ marginTop: 10, color: '#6d6480', lineHeight: 1.5 }}>
            Please use email sign-up for new accounts. We will add new emails to the Wanderlist automatically.
          </p>
        )}
      </section>
    </main>
  );
}
