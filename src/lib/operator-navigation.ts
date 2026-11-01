export const operatorLinks = [
  { id: 'home', href: '/', label: 'Main homepage' },
  { id: 'checkin', href: '/staff/checkin', label: 'Check-in & occupancy management' },
  { id: 'parties', href: '/staff/parties', label: 'Party management' },
  { id: 'families', href: '/staff/families', label: 'Family management' },
  { id: 'classes', href: '/staff/classes', label: 'Class management' },
] as const;

export const personalBookingLinks = [
  { id: 'my-parties', href: '/landing/party', label: 'My parties' },
  { id: 'my-classes', href: '/landing/classschedule', label: 'My classes' },
] as const;

export function activeOperatorLink(pathname: string) {
  return [...operatorLinks, ...personalBookingLinks].find(link => link.href === '/' ? pathname === '/' : pathname === link.href || pathname.startsWith(`${link.href}/`))?.id;
}
