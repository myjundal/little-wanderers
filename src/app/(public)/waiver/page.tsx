import GuestWaiverForm from '@/components/waivers/GuestWaiverForm';

export const metadata = { title: 'Family waiver | Little Wanderers', robots: { index: false, follow: false } };

export default function WaiverEntryPage() {
  return <GuestWaiverForm />;
}
