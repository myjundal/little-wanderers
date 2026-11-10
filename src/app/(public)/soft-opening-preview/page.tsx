import { notFound } from 'next/navigation';
import SoftOpeningReservation from '@/components/soft-opening/SoftOpeningReservation';
export default function Page() {
    if (process.env.NODE_ENV !== 'development')
        notFound();
    const slots = Array.from({ length: 51 }, (_, day) => { const date = new Date(Date.UTC(2026, 10, 11 + day)).toISOString().slice(0, 10); return Array.from({ length: day < 5 ? 5 : 8 }, (_, i) => ({ id: `preview-${day}-${i}`, starts_at: `${date}T${String(i + 9).padStart(2, '0')}:00:00-05:00`, ends_at: `${date}T${String(i + 10).padStart(2, '0')}:00:00-05:00`, remaining_children: i === 2 ? 2 : 5, is_closed: false, is_full: false })); }).flat();
    return <SoftOpeningReservation previewData={{ ok: true, allowed: true, slots, reservations: [], family: { guardian: null, children: [], memberships: [] } }}/>;
}
