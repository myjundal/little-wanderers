'use client';
import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';

export default function AccountLoginLinker() {
  const [identity, setIdentity] = useState<{ email?: string; phone?: string } | null>(null);
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [contact, setContact] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    void fetch('/api/account/link', { cache: 'no-store' }).then(r => r.json()).then(data => { if (!data.ok) throw new Error('Unable to check connected logins.'); setIdentity(data); setMethod(data.email ? 'phone' : 'email'); }).catch(() => setMessage('Unable to check connected logins. Please refresh.'));
    const status = new URLSearchParams(window.location.search).get('account_link');
    if (status) setMessage(status === 'connected' ? 'Your logins now open the same family, membership and reservations.' : status === 'expired' ? 'The connection expired. Start again below.' : 'The logins could not be connected. Contact Little Wanderers if both have family records.');
  }, []);
  async function connect() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/account/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, contact: method === 'phone' && contact.replace(/\D/g, '').length === 10 ? `1${contact}` : contact }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to connect logins.');
      const signedOut = await createBrowserSupabaseClient().auth.signOut({ scope: 'local' });
      if (signedOut.error) throw signedOut.error;
      window.location.assign(result.login);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Please try again.'); setBusy(false); }
  }
  return <section style={{ marginTop: 20, padding: 20, border: '1px solid #eadfff', borderRadius: 16, background: '#fff' }} aria-label="Connected sign-in methods">
    <h2>Email &amp; phone sign-in</h2>
    <p>Use either connected login to open the same family, membership and reservations.</p>
    {identity ? <p>Email: {identity.email || 'Not connected'}<br />Phone: {identity.phone ? `+${identity.phone}` : 'Not connected'}</p> : !message && <p>Checking your connected logins…</p>}
    {identity && (!identity.email || !identity.phone) && <><p>Connect your other sign-in method by verifying it once. Your family records stay saved.</p><label>Sign-in method <select value={method} onChange={e => { setMethod(e.target.value as 'email' | 'phone'); setContact(''); }}><option value="email">Email</option><option value="phone">US phone number</option></select></label><label style={{ display: 'block', margin: '12px 0' }}>Email or phone<input type={method === 'email' ? 'email' : 'tel'} value={contact} onChange={e => setContact(e.target.value)} /></label><button type="button" disabled={busy || !contact.trim()} onClick={() => void connect()}>{busy ? 'Opening verification…' : 'Verify & connect this login'}</button></>}
    {message && <p role="status">{message}</p>}
  </section>;
}
