export const operatorLinks = [
  { id: 'dashboard', href: '/staff/dashboard', label: 'My dashboard' },
  { id: 'admin', href: '/staff/admin', label: 'Timecard & admin' },
  { id: 'home', href: '/', label: 'Main homepage' },
  { id: 'checkin', href: '/staff/checkin', label: 'Check-in & occupancy management' },
  { id: 'parties', href: '/staff/parties', label: 'Party management' },
  { id: 'families', href: '/staff/families', label: 'Family management' },
  { id: 'classes', href: '/staff/classes', label: 'Class management' },
] as const;

export const operatorQuickLinks = [
  operatorLinks[0],
  { id: 'checkin', href: '/staff/checkin', label: 'Check-in' },
] as const;

export const personalBookingLinks = [
  { id: 'my-parties', href: '/landing/party', label: 'My parties' },
  { id: 'my-classes', href: '/landing/classschedule', label: 'My classes' },
] as const;

export function activeOperatorLink(pathname: string) {
  if (pathname === '/landing') return 'dashboard';
  return [...operatorLinks, ...personalBookingLinks].find(link => link.href === '/' ? pathname === '/' : pathname === link.href || pathname.startsWith(`${link.href}/`))?.id;
}

export const instructorLinks = [
  { id: 'dashboard', href: '/teaching', label: 'My dashboard' },
  { id: 'timecards', href: '/employee', label: 'My timecards' },
  { id: 'home', href: '/', label: 'Main homepage' },
] as const;

export function activeInstructorLink(pathname: string) {
  return instructorLinks.find(link => link.href === '/' ? pathname === '/' : pathname === link.href || pathname.startsWith(`${link.href}/`))?.id;
}
