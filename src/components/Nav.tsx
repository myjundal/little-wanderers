import { PastelHeader } from '@/components/pastel/PastelPrimitives';

export default function Nav() {
  // Resolve identity when opening the account, so public browsing/prefetching
  // can use static HTML without an auth and role lookup on every request.
  return <PastelHeader dashboardHref="/account" accessLabel="My account" />;
}
