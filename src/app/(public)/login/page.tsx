'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

type AuthMethod = 'phone' | 'email';
type JourneyMode = 'new' | 'existing';
type Step = 'collect' | 'verify';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

const normalizeUsPhone = (input: string) => {
  const digits = input.replace(/\D/g, '');
  if (!digits) return '';

  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return `+1${local}`;
};

export default function LoginPage() {
  const [authMethod, setAuthMethod] = useState<AuthMethod>('phone');
  const [journeyMode, setJourneyMode] = useState<JourneyMode>('existing');
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

  useEffect(() => {
    if (step === 'collect') {
      firstInputRef.current?.focus();
    } else {
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

  const clearFeedback = () => {
    setError(null);
    setMessage(null);
  };

  const requestOtp = async (reason: 'send' | 'resend') => {
    clearFeedback();
    setPending(true);

    const supabase = createBrowserSupabaseClient();
    const shouldCreateUser = journeyMode === 'new';

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
          },
        });

    setPending(false);

    if (response.error) {
      const safeError = response.error.message.toLowerCase();
      if (!shouldCreateUser && safeError.includes('not found')) {
        setError('Something went wrong');
        return;
      }
      setError('Something went wrong');
      return;
    }

    if (authMethod === 'phone') {
      setPendingPhone(normalizedPhone);
      setMessage(reason === 'send' ? 'We sent a 6-digit code by text.' : 'We sent a new code.');
    } else {
      setPendingEmail(normalizedEmail);
      setMessage(reason === 'send' ? 'We sent a 6-digit code by email.' : 'We sent a new code.');
    }

    setStep('verify');
    setOtpDigits(Array(OTP_LENGTH).fill(''));
    setLastAutoSubmitToken(null);
    setResendIn(RESEND_SECONDS);
  };

  const verifyOtp = async () => {
    clearFeedback();
    if (otpToken.length !== OTP_LENGTH) {
      setError('Something went wrong');
      return;
    }

    setPending(true);
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

    setPending(false);

    if (response.error) {
      setError('Something went wrong');
      setLastAutoSubmitToken(null);
      return;
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setError('Something went wrong');
      return;
    }

    const next = sessionStorage.getItem('post_login_redirect') || '/landing';
    sessionStorage.removeItem('post_login_redirect');
    window.location.replace(next);
  };

  const onOtpChange = (index: number, value: string) => {
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
  }, [step, otpToken, pending, lastAutoSubmitToken]);

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
        <p style={{ color: '#6d6480', lineHeight: 1.5, marginTop: 0 }}>Use your phone for a quick sign-in, then head to your family dashboard.</p>

        <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
          <label style={{ color: '#4f3f82', fontWeight: 600 }}>Account status</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" onClick={() => setJourneyMode('existing')} style={{ padding: '10px 12px', borderRadius: 12, border: journeyMode === 'existing' ? '2px solid #5f3da4' : '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 600 }}>I already have an account</button>
            <button type="button" onClick={() => setJourneyMode('new')} style={{ padding: '10px 12px', borderRadius: 12, border: journeyMode === 'new' ? '2px solid #5f3da4' : '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 600 }}>I am new</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={() => { setAuthMethod('phone'); setStep('collect'); clearFeedback(); }} style={{ padding: '11px 12px', borderRadius: 12, border: authMethod === 'phone' ? '2px solid #5f3da4' : '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 700 }}>Continue with phone</button>
          <button type="button" onClick={() => { setAuthMethod('email'); setStep('collect'); clearFeedback(); }} style={{ padding: '11px 12px', borderRadius: 12, border: authMethod === 'email' ? '2px solid #5f3da4' : '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 700 }}>Use email instead</button>
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
              type="email"
              ref={firstInputRef}
              autoComplete="email"
              placeholder="you@example.com"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              style={{ padding: '12px 14px', width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid #d8c5f6' }}
            />
            <button type="button" onClick={() => requestOtp('send')} disabled={!canRequestOtp || pending} style={{ marginTop: 4, padding: '12px 16px', borderRadius: 12, border: 'none', background: '#5f3da4', color: '#fff', fontWeight: 700 }}>
              {pending ? 'Sending…' : 'Email me a code'}
            </button>
          </div>
        )}

        {step === 'verify' && (
          <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
            <p style={{ margin: 0, color: '#6d6480' }}>
              Enter the 6-digit code sent to {authMethod === 'phone' ? pendingPhone : pendingEmail}.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8 }}>
              {otpDigits.map((digit, index) => (
                <input
                  key={`otp-${index}`}
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
              <button type="button" onClick={switchToEmailFallback} style={{ padding: '10px 12px', borderRadius: 12, border: 'none', background: 'transparent', color: '#5f3da4', textDecoration: 'underline', fontWeight: 600 }}>
                Did not get a text? Use email instead
              </button>
            )}

            <button type="button" onClick={() => { setStep('collect'); clearFeedback(); }} style={{ padding: '10px 12px', borderRadius: 12, border: 'none', background: 'transparent', color: '#6d6480', fontWeight: 600 }}>
              Change phone or email
            </button>
          </div>
        )}

        {message && <p style={{ marginTop: 14, color: '#5f3da4' }}>{message}</p>}
        {error && <p style={{ marginTop: 14, color: '#8a3f6b' }}>{error}</p>}
      </section>
    </main>
  );
}
