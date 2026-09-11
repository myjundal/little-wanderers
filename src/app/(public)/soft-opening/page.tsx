import Link from 'next/link';
import SoftOpeningSignInButton from '@/components/soft-opening/SoftOpeningSignInButton';
import { WAITLIST_JOIN_URL } from '@/lib/waitlist';

export const metadata = {
  title: 'Wanderlist Soft Opening — Little Wanderers',
  description: 'Private soft opening access for Wanderlist families and party early access families.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function SoftOpeningInvitePage() {
  return (
    <main style={{ maxWidth: 980, margin: '22px auto 64px', padding: '0 clamp(16px,4vw,28px)' }}>
      <section
        style={{
          display: 'grid',
          gap: 18,
          border: '1px solid #e8dfef',
          borderRadius: 28,
          background: '#fffdf9',
          boxShadow: '0 18px 34px rgba(158,143,191,.12)',
          padding: 'clamp(22px,5vw,44px)',
        }}
      >
        <p style={{ margin: 0, color: '#7a63a5', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 12 }}>
          Private Wanderlist access
        </p>
        <div style={{ display: 'grid', gap: 10, maxWidth: 760 }}>
          <h1 style={{ margin: 0, color: '#4f3f82', fontSize: 'clamp(2.1rem,5vw,4rem)', lineHeight: 1.02 }}>
            Wanderlist Soft Opening
          </h1>
          <p style={{ margin: 0, color: '#5f5570', fontSize: 'clamp(1.02rem,2vw,1.22rem)', lineHeight: 1.7 }}>
            We are preparing a small soft opening window before Little Wanderers opens to the public. Wanderlist families
            and birthday party early access families will be invited to choose a visit time first.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12 }}>
          {[
            ['Limited preview visits', 'A calmer first look at the play studio while we fine-tune opening flow.'],
            ['Wanderlist first', 'Access will be reserved for families already on the Wanderlist or connected to party early access.'],
            ['Reservation required', 'Soft opening visits will be scheduled by time window so the space stays comfortable.'],
          ].map(([title, copy]) => (
            <article key={title} style={{ border: '1px solid #eadfff', borderRadius: 16, background: '#faf7ff', padding: 16 }}>
              <strong style={{ display: 'block', color: '#4f3f82' }}>{title}</strong>
              <p style={{ margin: '8px 0 0', color: '#6d6480', lineHeight: 1.55 }}>{copy}</p>
            </article>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <SoftOpeningSignInButton>Sign in for soft opening access</SoftOpeningSignInButton>
          <Link
            href={WAITLIST_JOIN_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 50,
              padding: '10px 22px',
              borderRadius: 999,
              border: '1px solid #CFC0E2',
              color: '#7a63a5',
              fontWeight: 800,
              textDecoration: 'none',
            }}
          >
            Join the Wanderlist
          </Link>
        </div>

        <p style={{ margin: 0, color: '#7b7188', fontSize: 14, lineHeight: 1.6 }}>
          Please use the same email you used for the Wanderlist or your party early access request.
        </p>
      </section>
    </main>
  );
}
