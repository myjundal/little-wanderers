import FoundingMembership from '@/components/membership/FoundingMembership';

export const metadata = {
  title: 'Public Founding Membership',
  description: 'Public founding membership: $50/month + $20 per eligible sibling, locked in while active. No payment today.',
  robots: { index: false, follow: false },
};

export default function PublicFoundingMembershipPage() {
  return <FoundingMembership audience="public" />;
}
