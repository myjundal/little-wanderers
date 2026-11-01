import { redirect } from 'next/navigation';

export default function OccupancyPage() {
  redirect('/staff/checkin?view=occupancy');
}
