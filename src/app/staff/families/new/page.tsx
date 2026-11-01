'use client';

import { useRouter } from 'next/navigation';
import StaffFamilyRegistration from '@/components/staff/StaffFamilyRegistration';
import StaffToolNav from '@/components/staff/StaffToolNav';

export default function NewFamilyPage() {
  const router = useRouter();
  return <main style={{ padding: 24, maxWidth: 1180, margin: '0 auto' }}>
    <StaffToolNav active="families" />
    <h1 style={{ color: '#4f3f82' }}>New family</h1>
    <StaffFamilyRegistration onSaved={async () => { router.refresh(); }} />
  </main>;
}
