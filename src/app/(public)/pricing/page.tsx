export const metadata = { title: 'Pricing — Little Wanderers' };

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px dashed #e6daf9',
        minWidth: 0,
      }}
    >
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{label}</span>
      <strong style={{ whiteSpace: 'nowrap', color: '#5f4a97' }}>{value}</strong>
    </div>
  );
}

export default function PricingPage() {
  return (
    <main style={{ maxWidth: 860, margin: '20px auto', padding: 24 }}>
      <h1>Pricing</h1>
      <p style={{ color: '#6f648d', maxWidth: 700 }}>
        Simple, transparent pricing for adults and children. Membership gives you the best long-term value.
      </p>

      <section style={{ marginTop: 16, maxWidth: 620, border: '1px solid #e8dcfa', borderRadius: 16, background: '#fff', padding: 14, minWidth: 0 }}>
        <PriceRow label="Adult (per person)" value="$10" />
        <PriceRow label="Child (per person, 7 months+)" value="$10" />
        <PriceRow label="Infant (0–6 months)" value="$5" />
      </section>

      <section style={{ marginTop: 24, border: '1px solid #e8dcfa', borderRadius: 16, background: '#fff', padding: 16, minWidth: 0 }}>
        <h2 style={{ marginTop: 0 }}>Monthly Membership</h2>
        <p style={{ margin: 0, overflowWrap: 'anywhere' }}>
          <strong>$60/month</strong> for family membership access.
        </p>
      </section>
    </main>
  );
}
