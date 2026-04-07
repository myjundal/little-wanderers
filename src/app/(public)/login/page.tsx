'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

type AuthMethod = 'phone' | 'email';
type JourneyMode = 'new' | 'existing';
type Step = 'collect' | 'verify';

const COUNTRY_CODES = [
  { label: 'US +1', value: '+1' },
  { label: 'KR +82', value: '+82' },
  { label: 'CA +1', value: '+1' },
  { label: 'JP +81', value: '+81' },
  { label: 'UK +44', value: '+44' },
];

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

const normalizePhone = (countryCode: string, localPhone: string) => {
  const digits = localPhone.replace(/\D/g, '');
  if (!digits) return '';

  const trimmedCountry = countryCode.replace('+', '');
  const localWithoutCountryPrefix = digits.startsWith(trimmedCountry)
    ? digits.slice(trimmedCountry.length)
    : digits;

  return `+${trimmedCountry}${localWithoutCountryPrefix}`;
};

export default function LoginPage() {
  const [authMethod, setAuthMethod] = useState<AuthMethod>('phone');
  const [journeyMode, setJourneyMode] = useState<JourneyMode>('existing');
  const [countryCode, setCountryCode] = useState('+1');
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

  const normalizedPhone = useMemo(() => normalizePhone(countryCode, phoneInput), [countryCode, phoneInput]);
  const normalizedEmail = useMemo(() => emailInput.trim().toLowerCase(), [emailInput]);
  const otpToken = otpDigits.join('');

  const canRequestOtp = authMethod === 'phone'
    ? /^\+\d{8,15}$/.test(normalizedPhone)
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
        setError('계정을 찾지 못했어요. "처음이에요"로 바꾸거나 다른 로그인 방법을 써 주세요.');
        return;
      }
      setError(`코드 전송에 실패했어요: ${response.error.message}`);
      return;
    }

    if (authMethod === 'phone') {
      setPendingPhone(normalizedPhone);
      setMessage(reason === 'send' ? '문자로 6자리 코드를 보냈어요.' : '새 코드를 다시 보냈어요.');
    } else {
      setPendingEmail(normalizedEmail);
      setMessage(reason === 'send' ? '이메일로 6자리 코드를 보냈어요.' : '새 코드를 다시 보냈어요.');
    }

    // OTP 화면 진입 시 입력값과 재전송 타이머를 항상 초기화합니다.
    setStep('verify');
    setOtpDigits(Array(OTP_LENGTH).fill(''));
    setResendIn(RESEND_SECONDS);
  };

  const verifyOtp = async () => {
    clearFeedback();
    if (otpToken.length !== OTP_LENGTH) {
      setError('6자리 코드를 모두 입력해 주세요.');
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
      const safeError = response.error.message.toLowerCase();
      if (safeError.includes('expired')) {
        setError('코드가 만료됐어요. 새 코드를 요청해 주세요.');
        return;
      }
      setError('코드가 올바르지 않아요. 다시 확인해 주세요.');
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

  const switchToEmailFallback = () => {
    setAuthMethod('email');
    setStep('collect');
    clearFeedback();
  };

  return (
    <main style={{ padding: 16, maxWidth: 480, margin: '0 auto' }}>
      <section style={{ borderRadius: 24, border: '1px solid #e3d0fb', background: '#fff', boxShadow: '0 16px 28px rgba(120,87,177,0.12)', padding: 20 }}>
        <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Little Wanderers</p>
        <h1 style={{ margin: '10px 0 8px', color: '#4f3f82', fontSize: 26 }}>로그인</h1>
        <p style={{ color: '#6d6480', lineHeight: 1.5, marginTop: 0 }}>핸드폰으로 빠르게 로그인하고 가족 대시보드로 이동하세요.</p>

        <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
          <label style={{ color: '#4f3f82', fontWeight: 600 }}>계정 상태</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" onClick={() => setJourneyMode('existing')} style={{ padding: '10px 12px', borderRadius: 12, border: journeyMode === 'existing' ? '2px solid #5f3da4' : '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 600 }}>기존 회원</button>
            <button type="button" onClick={() => setJourneyMode('new')} style={{ padding: '10px 12px', borderRadius: 12, border: journeyMode === 'new' ? '2px solid #5f3da4' : '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 600 }}>처음이에요</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={() => { setAuthMethod('phone'); setStep('collect'); clearFeedback(); }} style={{ padding: '11px 12px', borderRadius: 12, border: authMethod === 'phone' ? '2px solid #5f3da4' : '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 700 }}>핸드폰으로 계속</button>
          <button type="button" onClick={() => { setAuthMethod('email'); setStep('collect'); clearFeedback(); }} style={{ padding: '11px 12px', borderRadius: 12, border: authMethod === 'email' ? '2px solid #5f3da4' : '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 700 }}>이메일 사용</button>
        </div>

        {step === 'collect' && authMethod === 'phone' && (
          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            <label htmlFor="countryCode" style={{ color: '#4f3f82', fontWeight: 600 }}>전화번호</label>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8 }}>
              <select id="countryCode" value={countryCode} onChange={(event) => setCountryCode(event.target.value)} style={{ padding: '12px 10px', borderRadius: 12, border: '1px solid #d8c5f6' }}>
                {COUNTRY_CODES.map((option) => (
                  <option key={`${option.label}-${option.value}`} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                ref={firstInputRef}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="(555) 123-4567"
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
                style={{ padding: '12px 14px', width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid #d8c5f6' }}
              />
            </div>
            <button type="button" onClick={() => requestOtp('send')} disabled={!canRequestOtp || pending} style={{ marginTop: 4, padding: '12px 16px', borderRadius: 12, border: 'none', background: '#5f3da4', color: '#fff', fontWeight: 700 }}>
              {pending ? '전송 중…' : '문자로 코드 받기'}
            </button>
          </div>
        )}

        {step === 'collect' && authMethod === 'email' && (
          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            <label htmlFor="email" style={{ color: '#4f3f82', fontWeight: 600 }}>이메일 주소</label>
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
              {pending ? '전송 중…' : '이메일로 코드 받기'}
            </button>
          </div>
        )}

        {step === 'verify' && (
          <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
            <p style={{ margin: 0, color: '#6d6480' }}>
              {authMethod === 'phone' ? `${pendingPhone} 으로 보낸` : `${pendingEmail} 로 보낸`} 6자리 코드를 입력해 주세요.
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
              {pending ? '확인 중…' : '코드 확인'}
            </button>

            <button type="button" disabled={resendIn > 0 || pending} onClick={() => requestOtp('resend')} style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid #d8c5f6', background: '#fff', color: '#4f3f82', fontWeight: 600 }}>
              {resendIn > 0 ? `코드 재전송 (${resendIn}s)` : '코드 재전송'}
            </button>

            {authMethod === 'phone' && (
              <button type="button" onClick={switchToEmailFallback} style={{ padding: '10px 12px', borderRadius: 12, border: 'none', background: 'transparent', color: '#5f3da4', textDecoration: 'underline', fontWeight: 600 }}>
                문자가 안 오나요? 이메일로 로그인
              </button>
            )}

            <button type="button" onClick={() => { setStep('collect'); clearFeedback(); }} style={{ padding: '10px 12px', borderRadius: 12, border: 'none', background: 'transparent', color: '#6d6480', fontWeight: 600 }}>
              입력 정보 다시 바꾸기
            </button>
          </div>
        )}

        {message && <p style={{ marginTop: 14, color: '#5f3da4' }}>{message}</p>}
        {error && <p style={{ marginTop: 14, color: '#8a3f6b' }}>{error}</p>}
      </section>
    </main>
  );
}
