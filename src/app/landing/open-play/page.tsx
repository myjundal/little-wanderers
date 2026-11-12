import SoftOpeningReservation from '@/components/soft-opening/SoftOpeningReservation';
export const metadata = { title: 'Reserve Open Play · Little Wanderers', robots: { index: false, follow: false } };
export default function Page() { return <SoftOpeningReservation publicBooking />; }
