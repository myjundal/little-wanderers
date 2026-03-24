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

const faqItems = [
  {
    q: 'What is Little Wanderers?',
    a: 'Little Wanderers is a thoughtfully designed play studio and café for children ages 0–7, centered around sensory exploration and gentle, restorative moments for parents.',
  },
  {
    q: 'What do you offer?',
    a: 'We offer open play focused on sensory development, a variety of classes (including Mommy & Me and kids-only), party and event rentals, and more.',
  },
  {
    q: 'Is drop-off permitted for open play?',
    a: 'No. Little Wanderers is a caregiver-accompanied space, so children must be with a caregiver at all times. For kids-only classes, caregivers should remain onsite outside the classroom.',
  },
  {
    q: 'Are there time limits for open play?',
    a: 'Open play is unlimited, with no time limits.',
  },
  {
    q: 'Do I need to reserve in advance?',
    a: 'We recommend booking in advance, especially on weekends and for classes, since spots are limited. Walk-ins are welcome, and we encourage checking the live occupancy status on our website before visiting.',
  },
  {
    q: 'How does payment work?',
    a: 'Classes and reservations are confirmed at the time of online booking and payment. Walk-in payment onsite is also available.',
  },
  {
    q: 'What is your cancellation policy?',
    a: 'We understand that plans can change. You can cancel or reschedule up to 24 hours in advance for credit toward a future visit.',
  },
  {
    q: 'Do you offer food and drinks?',
    a: 'Yes. We offer hot and cold coffee and drinks, along with pre-packaged snacks and bakery items, with a focus on healthier options.',
  },
  {
    q: 'Can I bring outside food?',
    a: 'Outside food is not permitted, except for private events or specific dietary needs. Small outside snacks are allowed.',
  },
  {
    q: 'Do you have memberships?',
    a: 'Yes, we offer monthly memberships.',
  },
  {
    q: 'What are your operating hours?',
    a: 'We plan to be open year-round: Sunday through Thursday from 9:00 AM to 6:00 PM, and Friday through Saturday from 9:00 AM to 7:00 PM. Hours may be adjusted based on demand.',
  },
  {
    q: 'How do you keep the space clean?',
    a: 'We clean and sanitize toys and surfaces throughout the day (approximately every 30 minutes) and thoughtfully curate materials to keep the environment safe and comfortable.',
  },
  {
    q: 'Do we need socks?',
    a: 'Yes, socks are required for both children and adults in the play area. Shoes are not allowed; cubbies for shoes and belongings are provided at the entrance.',
  },
  {
    q: 'Can I bring my child who is over 7 years old?',
    a: 'Children of all ages are welcome. However, our space is thoughtfully designed for younger children, and the experience is best suited for ages 0–7.',
  },
  {
    q: 'Will you offer sensory-friendly hours?',
    a: 'Yes, we plan to offer dedicated sensory-friendly sessions designed to create a calmer, more supportive environment for children with different needs.',
  },
] as const;

export default function FaqPage() {
  return (
    <main style={{ maxWidth: 900, margin: '20px auto', padding: 24 }}>
      <h1>FAQ</h1>
      <p style={{ color: '#6f648d', maxWidth: 720 }}>
        Quick answers to common questions from families visiting Little Wanderers.
      </p>

      <section style={{ marginTop: 14, minWidth: 0 }}>
        {faqItems.map((item) => (
          <QA key={item.q} q={item.q} a={item.a} />
        ))}
      </section>
    </main>
  );
}
