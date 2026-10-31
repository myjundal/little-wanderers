'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
type Item = { household_id: string; guardian_name: string; email: string; children: string[]; status: string; expires_at: string };
export default function PartyGuestWaivers({ partyId }: { partyId: string }) {
  const [data, setData] = useState<{ guest_url: string; qr_data_url: string; items: Item[]; truncated: boolean } | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(''); setCopied(false);
    void fetch(`/api/admin/party-bookings/${partyId}/waivers`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to load guest waivers.');
      if (!controller.signal.aborted) setData(result);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [partyId, refresh]);
  return <section style={{ marginTop: 20, padding: 16, border: '1px solid #dfd1ee', borderRadius: 12 }}>
    <h4 style={{ marginTop: 0 }}>Party guest waivers</h4>
    <p>Share this link or QR with guests. Each parent signs for their own children. No account is required.</p>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <Image src={data.qr_data_url} unoptimized alt="Scan to open this party’s guest waiver" width={220} height={220} />
      <p><a href={data.guest_url} target="_blank" rel="noreferrer">Open guest waiver</a></p>
      <p style={{ overflowWrap: 'anywhere' }}>{data.guest_url}</p>
      <button type="button" onClick={() => void navigator.clipboard.writeText(data.guest_url).then(() => setCopied(true)).catch(() => setError('Copy the link shown above.'))}>{copied ? 'Link copied' : 'Copy guest waiver link'}</button>
      <p><strong>{data.items.length} families with a waiver on file for this party</strong></p>
      <p>A saved waiver does not mark a guest as present or create an Open Play charge. Keep using the party attendance tracker for arrivals.</p>
      {!data.items.length ? <p>No guest waivers yet.</p> : <ul>{data.items.map(item => <li key={item.household_id} style={{ margin: '12px 0' }}>
        <strong>{item.guardian_name}</strong> · {item.email}<br />{item.children.join(', ')}<br />
        {item.status === 'completed' ? 'Waiver valid' : 'Waiver renewal required'} · <a href={`/staff/families/${item.household_id}`}>Family record</a>
      </li>)}</ul>}
      {data.truncated && <p>This roster reached its display limit. Check Family Management for more records.</p>}
    </>}
    <button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh guest waivers</button>
  </section>;
}
