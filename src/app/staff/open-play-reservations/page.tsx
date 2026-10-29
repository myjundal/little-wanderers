import { redirect } from 'next/navigation';

export default function StaffOpenPlayReservationsPage() {
  redirect('/staff/checkin?view=reservations');
}
