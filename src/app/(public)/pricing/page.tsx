export const metadata = { title: 'Pricing — Little Wanderers' };

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px dashed #eee'}}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function PricingPage() {
  return (
    <main>
      <h1>Pricing</h1>
      <p>Simple per-person pricing. Infants under 6 months get a special rate.</p>
      <div style={{marginTop:16, maxWidth:520}}>
        <PriceRow label="Adult (per person)" value="$10" />
        <PriceRow label="Child (per person, 7 months+)" value="$10" />
        <PriceRow label="Infant (0–6 months)" value="$5" />
      </div>

      <section style={{marginTop:24}}>
        <h2>Monthly Membership</h2>
        <ul>
          <li>Monthly Membership — $60/month</li>
        </ul>
        <p>Manage purchases in the <a href="/app/membership">App</a>.</p>
      </section>
    </main>
  );
}

