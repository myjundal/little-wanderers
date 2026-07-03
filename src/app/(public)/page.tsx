import HomeComingSoon from '@/components/home/HomeComingSoon';
import AuthLinkLandingGuard from '@/components/auth/AuthLinkLandingGuard';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Little Wanderers — Sensory-focused Studio and Cafe',
  description:
    'Little Wanderers is a toddler indoor play West Hartford families can trust, with a sensory play space CT parents love.',
  keywords: [
    'toddler indoor play West Hartford',
    'sensory play space CT',
    'indoor playground for toddlers',
  ],
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
