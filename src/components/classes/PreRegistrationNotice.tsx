import { CLASS_PRE_REGISTRATION_NOTE } from '@/lib/class-config';

export default function PreRegistrationNotice() {
  return (
    <aside style={{ margin: '16px 0', padding: '16px 18px', borderRadius: 16, border: '1px solid #d9c8f7', background: '#f3ebff', color: '#4f3f82', lineHeight: 1.7 }}>
      <strong style={{ display: 'block', marginBottom: 4 }}>Two ways to register — only payment confirms your seat</strong>
      <p style={{ margin: 0 }}>{CLASS_PRE_REGISTRATION_NOTE}</p>
    </aside>
  );
}
