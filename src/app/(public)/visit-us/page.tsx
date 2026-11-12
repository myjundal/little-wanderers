import Link from 'next/link';

export const metadata = {
  title: 'Visit Little Wanderers in West Hartford, CT',
  description: 'Find Little Wanderers Play Studio & Cafe in Bishop’s Corner, West Hartford, CT. Soft opening starts November 11, 2026. Plan your visit.',
};

export default function VisitUsPage() {
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px 40px', color: '#4A4A4A' }}>
      <section style={{ border: '1px solid #eadff3', borderRadius: 24, background: 'linear-gradient(180deg,#fff,#fbf7ff)', padding: 24 }}>
        <p style={{ margin: 0, color: '#8f85a5', fontWeight: 700, letterSpacing: '0.02em' }}>Little Wanderers Play Studio & Cafe • Soft opening starts November 11</p>
        <h1 style={{ margin: '8px 0 12px', color: '#A78BCB' }}>Visit us in Bishop’s Corner</h1>
        <p style={{ lineHeight: 1.7, marginBottom: 16 }}>
          We’re welcoming our first families to Bishop’s Corner in West Hartford, CT. All families are welcome to reserve Open Play visits from Saturday, November 14. Explore our new play studio and cafe at your own pace. Our grand opening date is coming soon.
        </p>
        <p style={{lineHeight:1.7}}>Soft opening: November 11–15, 9am–2pm. Regular opening from November 16: 9am–5pm (Eastern). Service may be slower while our team learns and finds its rhythm.</p>
        <p><Link href="/open-play">Reserve Open Play →</Link></p>
        <p style={{ marginBottom: 16 }}><strong>Location:</strong> Bishop&apos;s Corner, West Hartford, CT</p>
        <p style={{ lineHeight: 1.7, marginBottom: 16 }}>
          <strong>Landmark directions:</strong> On the Target side of the plaza, between The Paper Store and Float Forty One, near Marshalls, Chopt, and Koma.
        </p>
        <p style={{ lineHeight: 1.7, marginBottom: 16 }}><strong>Parking & arrival:</strong> Parking is easy and plentiful throughout Bishop’s Corner, with convenient access from the Target side of the plaza.</p>
        <p style={{ lineHeight: 1.7, marginBottom: 16 }}>For birthday parties or larger celebrations, families are welcome to briefly pull up near the loading area while unloading supplies. Our team will be happy to help carry items inside whenever possible.</p>
        <p style={{ lineHeight: 1.7, marginBottom: 0 }}>Strollers are welcome with stroller parking zone.</p>
      </section>
    </main>
  );
}
