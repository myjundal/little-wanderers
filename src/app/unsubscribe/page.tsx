import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Unsubscribe — Little Wanderers' };

export default async function UnsubscribePage({ searchParams }: { searchParams?: { token?: string } }) {
  const token = String(searchParams?.token ?? '').trim();
  let title = 'Unable to unsubscribe';
  let message = 'This unsubscribe link is missing or no longer valid.';

  if (token === 'test') {
    title = 'Test unsubscribe link';
    message = 'This is the test email unsubscribe link. No contact was changed.';
  } else if (token) {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin
      .from('contacts')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('unsubscribe_token', token)
      .select('email')
      .maybeSingle();

    if (!error && data) {
      title = 'You are unsubscribed';
      message = 'You will no longer receive marketing emails from Little Wanderers.';
    }
  }

  return (
    <main style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: 24, background: '#fbf8f3' }}>
      <section style={{ width: '100%', maxWidth: 560, border: '1px solid #eadff3', borderRadius: 22, background: '#fff', padding: 24, boxShadow: '0 16px 28px rgba(158,143,191,0.08)' }}>
        <p style={{ margin: 0, color: '#7a63a5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Little Wanderers</p>
        <h1 style={{ margin: '8px 0 10px', color: '#4f3f82' }}>{title}</h1>
        <p style={{ color: '#6d6480', lineHeight: 1.6 }}>{message}</p>
        <Link href="/" style={{ color: '#5f3da4', fontWeight: 700, textDecoration: 'none' }}>
          Back to Little Wanderers
        </Link>
      </section>
    </main>
  );
}
