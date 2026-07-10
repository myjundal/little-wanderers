import AnalyticsOptOutPanel from '@/components/AnalyticsOptOutPanel';

export const metadata = {
  title: 'Analytics Opt-Out',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AnalyticsOptOutPage() {
  return <AnalyticsOptOutPanel />;
}
