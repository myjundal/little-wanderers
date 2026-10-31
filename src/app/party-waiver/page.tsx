import GuestWaiverForm from '@/components/waivers/GuestWaiverForm';
export const metadata = { title: 'Guest family waiver', robots: { index: false, follow: false } };
export default function PartyWaiverPage() { return <div style={{ minHeight: '100vh', paddingTop: 24, background: '#faf7f2' }}><GuestWaiverForm /></div>; }
