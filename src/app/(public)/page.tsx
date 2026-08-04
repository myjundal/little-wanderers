import HomeComingSoon from '@/components/home/HomeComingSoon';
import AuthLinkLandingGuard from '@/components/auth/AuthLinkLandingGuard';
import { redirect } from 'next/navigation';

export const metadata = {
  title: {
    absolute: 'Little Wanderers Play Studio & Cafe | West Hartford, CT',
  },
  description:
    'Little Wanderers Play Studio & Cafe is a West Hartford, CT indoor play cafe for kids ages 0-7 and their grown-ups in Bishop’s Corner.',
  keywords: [
    'Little Wanderers West Hartford',
    'Little Wanderers Play Studio',
    'Little Wanderers Play Cafe',
    'Little Wanderers Cafe',
    'West Hartford play studio',
    'West Hartford play cafe',
    'West Hartford kids cafe',
    'West Hartford indoor play',
    'Bishop’s Corner kids play cafe',
    'toddler indoor play West Hartford',
    'kids play cafe West Hartford',
    'indoor playground for toddlers',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Little Wanderers Play Studio & Cafe in West Hartford, CT',
    description:
      'A dreamy indoor play studio and cafe for families in Bishop’s Corner, West Hartford, CT.',
    url: '/',
    type: 'website',
    images: [
      {
        url: '/logo.png',
        width: 1254,
        height: 1254,
        alt: 'Little Wanderers Play Studio & Cafe logo',
      },
    ],
  },
};

export default function HomePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  if (searchParams?.code || searchParams?.token_hash) {
    const params = new URLSearchParams();
    Object.entries(searchParams).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => params.append(key, item));
      } else if (value) {
        params.set(key, value);
      }
    });
    redirect(`/auth/callback?${params.toString()}`);
  }

  return (
    <>
      <AuthLinkLandingGuard />
      <HomeComingSoon />
    </>
  );
}
