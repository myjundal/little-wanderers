export type MembershipAdmissionTerm = {
  status: string;
  start_date: string | null;
  paid_through: string | null;
  square_card_id?: string | null;
  square_subscription_id?: string | null;
  active_subscription?: boolean;
};

/** An activated membership is distinct from confirmation of its monthly invoice. */
export function membershipCoversAdmission(term: MembershipAdmissionTerm, date: string) {
  if (term.status === 'complimentary') return true;
  if (['pending', 'activating', 'scheduled'].includes(term.status)) return true;
  if (term.status === 'active' && !term.start_date) return true;
  if (!term.start_date || term.start_date > date) return false;
  if (['active', 'canceling', 'canceled'].includes(term.status) && term.paid_through && term.paid_through >= date) return true;
  // Older activations can be active with no invoice confirmation saved. Do not
  // turn that missing billing field into a second, per-visit admission charge.
  // This never marks an invoice paid or extends a known expired term.
  return term.status === 'active' && term.paid_through === null
    && (term.active_subscription === true || Boolean(term.square_subscription_id && term.square_card_id));
}
