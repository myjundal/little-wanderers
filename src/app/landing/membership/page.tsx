export const metadata = { title: 'Membership — Little Wanderers' };

export default function MembershipPage() {
  return (
    <main style={{ padding: 24, maxWidth: 560 }}>
      <h1>Membership</h1>
      <p>Choose a product to get started. Payments coming soon.</p>
      <div style={{ display:'grid', gap:12, marginTop:16 }}>
        <button>Start Monthly Membership</button>
      </div>
      <p style={{ marginTop:12, color:'#666' }}>
        You can manage your membership here once payments are enabled.
      </p>
    </main>
  );
}

