export const metadata = { title: 'FAQ — Little Wanderers' };

function QA({ q, a }: { q: string; a: string }) {
  return (
    <article
      style={{
        margin: '12px 0',
        border: '1px solid #e8dfef',
        borderRadius: 22,
        background: '#fffdf9',
        padding: 16,
        minWidth: 0,
        boxShadow: '0 10px 20px rgba(158,143,191,0.08)',
      }}
    >
      <p style={{ margin: 0, fontWeight: 700, color: '#9E8FBF', overflowWrap: 'anywhere', fontFamily: 'var(--font-heading)' }}>{q}</p>
      <p style={{ margin: '8px 0 0', color: '#4A4A4A', overflowWrap: 'anywhere', lineHeight: 1.7 }}>{a}</p>
    </article>
  );
}

const faqItems = [
  { q: 'What is Little Wanderers?', a: 'Little Wanderers is a thoughtfully designed play studio and café for children ages 0–7, centered around sensory exploration and gentle, restorative moments for parents.' },
  { q: 'What do you offer?', a: 'We offer open play focused on sensory development, a variety of classes (including Mommy & Me and kids-only), party and event rentals, and more.' },
  { q: 'Is drop-off permitted for open play?', a: 'No. Little Wanderers is a caregiver-accompanied space, so children must be with a caregiver at all times. For kids-only classes, caregivers should remain onsite outside the classroom.' },
  { q: 'Are there time limits for open play?', a: 'Open play is unlimited, with no time limits.' },
] as const;

export default function FaqPage() {
  return (
    <main style={{ maxWidth: 980, margin: '20px auto', padding: 24, background: '#F7F4EF', border: '1px solid #ece2d8', borderRadius: 32 }}>
      <h1 style={{ margin: 0, color: '#A78BCB', fontSize: 'clamp(2rem,4vw,3rem)' }}>FAQ</h1>
      <p style={{ color: '#4A4A4A', maxWidth: 720, lineHeight: 1.8, marginTop: 12 }}>
        Quick answers to common questions from families visiting Little Wanderers.
      </p>
      <section style={{ marginTop: 18, minWidth: 0 }}>{faqItems.map((item) => <QA key={item.q} q={item.q} a={item.a} />)}</section>
    </main>
  );
}
