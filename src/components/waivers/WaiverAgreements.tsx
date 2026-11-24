import { WAIVER_AGREEMENTS } from '@/lib/waiver-content';
import styles from '@/app/landing/waiver/waiver.module.css';

export default function WaiverAgreements({ checked, onChange, error }: {
  checked: boolean; onChange: (checked: boolean) => void; error?: string;
}) {
  return <section className={styles.card}>
    <h2>Required agreements</h2>
    <p>Please check the box at the bottom to agree to all statements.</p>
    <ul id="waiver-statements" className={styles.agreementList}>
      <li>I am the parent or legal guardian of all children listed above.</li>
      {WAIVER_AGREEMENTS.map(item => <li key={item.id}>{item.text}</li>)}
      <li>I agree to use this typed name as my electronic signature for this waiver.</li>
    </ul>
    <label className={styles.check}>
      <input id="all-agreements" type="checkbox" required checked={checked} onChange={event => onChange(event.target.checked)}
        aria-invalid={Boolean(error) || undefined} aria-describedby={`waiver-statements${error ? ' all-agreements-error' : ''}`} />
      <strong>I agree to all statements above.</strong>
    </label>
    {error && <p id="all-agreements-error" className={styles.fieldError}>{error}</p>}
  </section>;
}
