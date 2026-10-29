import { CLASS_PRE_REGISTRATION_NOTE } from '@/lib/class-config';

export default function PreRegistrationNotice({ paymentsEnabled = false }: { paymentsEnabled?: boolean } = {}) {
  return (
    <aside style={{ margin: '16px 0', padding: '16px 18px', borderRadius: 16, border: '1px solid #d9c8f7', background: '#f3ebff', color: '#4f3f82', lineHeight: 1.7 }}>
      <strong style={{ display: 'block', marginBottom: 4 }}>{paymentsEnabled ? 'Payment confirms your class registration' : 'Pre-registration only — your spot is not yet confirmed'}</strong>
      <p style={{ margin: 0 }}>{paymentsEnabled ? 'Free pre-registration shares your interest and does not reserve a spot. Choose Pay & register to confirm a place after your payment is verified.' : CLASS_PRE_REGISTRATION_NOTE}</p>
    </aside>
  );
}
