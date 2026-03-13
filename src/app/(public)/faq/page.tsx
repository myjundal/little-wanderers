export const metadata = { title: 'FAQ — Little Wanderers' };

function QA({ q, a }: { q: string; a: string }) {
  return (
    <article
      style={{
        margin: '12px 0',
        border: '1px solid #e8dcfa',
        borderRadius: 14,
        background: '#fff',
        padding: 14,
        minWidth: 0,
      }}
    >
      <p style={{ margin: 0, fontWeight: 700, color: '#4f3f74', overflowWrap: 'anywhere' }}>{q}</p>
      <p style={{ margin: '8px 0 0', color: '#6f648d', overflowWrap: 'anywhere' }}>{a}</p>
    </article>
  );
}

export default function FaqPage() {
  return (
    <main style={{ maxWidth: 900, margin: '20px auto', padding: 24 }}>
      <h1>FAQ</h1>
      <p style={{ color: '#6f648d', maxWidth: 720 }}>
        Quick answers to common questions from families visiting Little Wanderers.
      </p>

      <section style={{ marginTop: 14, minWidth: 0 }}>
        <QA
          q="Do I need to book in advance?"
          a="Walk-ins are welcome, but booking ahead is recommended to keep the space comfortable and capacity-balanced."
        />
        <QA q="Do you have memberships?" a="Yes. We offer monthly memberships." />
        <QA
          q="Do you offer food and drinks?"
          a="We provide hot and cold drinks for adults, plus kid-friendly snacks and drinks."
        />
        <QA q="Where are you located?" a="West Hartford, Connecticut." />
      </section>
    </main>
  );
}
