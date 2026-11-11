export type AdmissionPayment = { payment_status: string; price_cents: number; infant_sibling_free?: boolean };
export const admissionIsPaid = (status: string) => ['paid', 'prepaid', 'walkin_paid', 'terminal_paid'].includes(status);
export const admissionIsIncluded = (status: string) => ['covered', 'included', 'membership'].includes(status);
export function admissionPaymentLabel(visit: AdmissionPayment) {
  if (visit.infant_sibling_free) return 'Infant sibling included';
  if (visit.payment_status === 'prepaid') return 'Paid in advance';
  if (admissionIsPaid(visit.payment_status)) return 'Paid';
  if (admissionIsIncluded(visit.payment_status)) return 'Included';
  if (visit.payment_status === 'due' && visit.price_cents > 0) return `$${(visit.price_cents / 100).toFixed(2)} due`;
  return 'Payment status needs review';
}
export type ReservationAdmissionStatus = 'paid_online' | 'paid_counter' | 'paid_or_included' | 'included' | 'due' | 'pending' | 'review';
export function reservationAdmissionLabel(status?: ReservationAdmissionStatus, amount = 0) {
  switch (status) {
    case 'paid_online': return 'Admission paid online — do not collect again';
    case 'paid_counter': return 'Admission paid in Square — do not collect again';
    case 'paid_or_included': return 'Admission paid / included — no payment due';
    case 'included': return 'Admission included — no payment due';
    case 'due': return `$${(amount / 100).toFixed(2)} admission due`;
    case 'pending': return 'Online payment pending — verify before collecting';
    case 'review': return 'Admission payment needs review — do not collect again';
    default: return null;
  }
}
