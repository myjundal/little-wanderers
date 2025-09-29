import Link from 'next/link';

export const metadata = {
  title: 'Little Wanderers — Sensory-filled Learning Play Adventure',
  description: 'Play, learn, and wander in West Hartford.',
};

export default function HomePage() {
  return (
    <main>
      <h1>Welcome to Little Wanderers</h1>
      <p>West Hartford first and only sensory-filled learning play adventure for families with young children.</p>

      <section style={{marginTop:24}}>
        <h2>Hours</h2>
        <p>Sun–Thurs 9AM–6PM, Fri-Sat 9AM-7PM (subject to change)</p>
      </section>

      <section style={{marginTop:24}}>
        <h2>Location</h2>
        <p>West Hartford, CT</p>
      </section>

      <section style={{marginTop:24}}>
        <h2>Get started</h2>
        <ul>
         <p><Link href="/pricing" className="text-blue-500 hover:underline">Check our Pricing</Link></p>
         <p><Link href="/faq" className="text-blue-500 hover:underline">Read our FAQ</Link></p>
          <p><Link href="/login" className="text-blue-500 hover:underline">Login to manage your 
family, membership, and bookings</Link></p>
        </ul>
      </section>
    </main>
  );
}

