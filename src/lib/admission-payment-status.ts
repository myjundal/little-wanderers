export type AdmissionPayment = { payment_status: string; price_cents: number; membership_applied?: boolean; founding_membership_applied?: boolean; infant_sibling_free?: boolean; checked_out?: boolean; checked_out_at?: string | null };
export const admissionIsPaid = (status: string) => ['paid', 'prepaid', 'walkin_paid', 'terminal_paid'].includes(status);
export const admissionIsIncluded = (status: string) => ['covered', 'included', 'membership'].includes(status);
export const admissionIsMembership = (visit: AdmissionPayment) => admissionIsIncluded(visit.payment_status)
  && (visit.payment_status === 'membership' || visit.membership_applied === true || visit.founding_membership_applied === true);
export function admissionPaymentLabel(visit: AdmissionPayment) {
  if (visit.payment_status === 'pending') return 'Checking Square payment';
  if (visit.payment_status === 'review') return 'Check Square receipt — do not charge again';
  if (admissionIsPaid(visit.payment_status)) return 'Paid';
  if (admissionIsMembership(visit)) return 'Membership';
  if (visit.infant_sibling_free) return 'Infant admission included';
  if (admissionIsIncluded(visit.payment_status)) return 'Included';
  if (visit.payment_status === 'due' && visit.price_cents > 0) {
    const amount = `$${(visit.price_cents / 100).toFixed(2)}`;
    return visit.checked_out || visit.checked_out_at ? `${amount} · Verify Square receipt` : `${amount} due`;
  }
  return 'Payment status needs review';
}
export type ReservationAdmissionStatus = 'paid_online' | 'paid_counter' | 'paid_or_included' | 'paid_or_membership' | 'membership' | 'included' | 'due' | 'pending' | 'review';
export function reservationAdmissionLabel(status?: ReservationAdmissionStatus, amount = 0) {
  switch (status) {
    case 'paid_online':
    case 'paid_counter': return 'Paid';
    case 'paid_or_included': return 'Paid / Included';
    case 'paid_or_membership': return 'Paid / Membership';
    case 'membership': return 'Membership';
    case 'included': return 'Included';
    case 'due': return `$${(amount / 100).toFixed(2)} admission due`;
    case 'pending': return 'Checking payment — do not collect again';
    case 'review': return 'Admission payment needs review — do not collect again';
    default: return null;
  }
}
