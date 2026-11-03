import FoundingMembership from '@/components/membership/FoundingMembership';

export const metadata = {
  title: 'Founding Membership',
  description: 'Be part of the beginning. $50/month while your membership stays active. Save your card now; no payment today.',
  robots: { index: false, follow: false },
};

export default function FoundingMembershipPage() {
  return <FoundingMembership />;
}
