import { redirect } from 'next/navigation';

export default function WaiverEntryPage() {
  redirect('/login?next=/landing/waiver');
}
