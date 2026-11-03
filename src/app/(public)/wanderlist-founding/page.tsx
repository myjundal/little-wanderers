import FoundingMembership from '@/components/membership/FoundingMembership';

export const metadata = {
  title: 'Wanderlist Founding Membership',
  description: 'Original Wanderlist families: $50/month + $10 per eligible sibling, locked in while active. No payment today.',
  robots: { index: false, follow: false },
};

export default function WaitlistFoundingMembershipPage() {
  return <FoundingMembership audience="waitlist" />;
}
