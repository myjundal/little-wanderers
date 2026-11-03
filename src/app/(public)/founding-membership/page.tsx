import FoundingMembership from '@/components/membership/FoundingMembership';

export const metadata = {
  title: 'Founding Membership',
  description: 'Wanderlist and public founding memberships with lifetime rates while active. Save your card now; no payment today.',
  robots: { index: false, follow: false },
};

export default function FoundingMembershipPage() {
  return <FoundingMembership />;
}
