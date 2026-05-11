export const metadata = {
  title: 'Visit Us',
  description: 'Find Little Wanderers in Bishop’s Corner, West Hartford, CT. Opening 2026.',
};

export default function VisitUsPage() {
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px 40px', color: '#4A4A4A' }}>
      <section style={{ border: '1px solid #eadff3', borderRadius: 24, background: 'linear-gradient(180deg,#fff,#fbf7ff)', padding: 24 }}>
        <p style={{ margin: 0, color: '#8f85a5', fontWeight: 700, letterSpacing: '0.02em' }}>Little Wanderers • Opening 2026</p>
        <h1 style={{ margin: '8px 0 12px', color: '#A78BCB' }}>Visit us in Bishop’s Corner</h1>
        <p style={{ lineHeight: 1.7 }}>
          We&apos;re so excited to welcome families soon. Little Wanderers is coming to Bishop&apos;s Corner in West Hartford, CT, and we can&apos;t wait to share this dreamy new play-and-pause space with you.
        </p>
        <p style={{ marginBottom: 4 }}><strong>Location:</strong> Bishop&apos;s Corner, West Hartford, CT</p>
        <p style={{ marginTop: 0, lineHeight: 1.7 }}>
          <strong>Landmark directions:</strong> On the Target side of the plaza, between The Paper Store and Float Forty One, near Marshalls, Chopt, and Koma.
        </p>
        <p style={{ lineHeight: 1.7 }}>
          <strong>Parking & arrival:</strong> We&apos;ll share finalized parking and arrival details closer to opening. For now, plan to use the main Bishop&apos;s Corner plaza lots and follow onsite signage when we launch.
        </p>
      </section>
    </main>
  );
}
