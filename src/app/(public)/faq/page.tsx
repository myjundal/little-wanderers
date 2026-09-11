import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'FAQ — Little Wanderers',
  description: 'FAQ for Little Wanderers Play Studio & Cafe in West Hartford, CT.',
};

function QA({ q, a }: { q: string; a: ReactNode }) {
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
  { q: 'What is Little Wanderers?', a: 'Little Wanderers Play Studio & Cafe is a thoughtfully designed indoor play cafe in West Hartford, CT for children ages 0–5, with gentle, restorative moments for parents.' },
  { q: 'What do you offer?', a: 'We offer unlimited Open Play, small-group classes and programs, birthday parties and private events, and a cafe serving coffee and specialty drinks.' },
  { q: 'Is drop-off permitted for open play?', a: 'No. Little Wanderers is a caregiver-accompanied space, so children must be with a caregiver at all times. For kids-only classes, caregivers should remain onsite outside the classroom.' },
  { q: 'Are there time limits for open play?', a: 'Open play is unlimited, with no time limits.' },
  { q: 'Do I need to reserve in advance?', a: 'No. Walk-ins are welcome during regular Open Play hours. Admission is subject to capacity, and there may be a short wait during especially busy times.' },
  { q: 'What happens if Little Wanderers is at capacity?', a: 'To keep the play space comfortable and safe, we limit capacity. If we are full when you arrive, admission may temporarily pause until space becomes available.' },
  { q: 'Can we leave and come back?', a: 'Open Play admission does not include re-entry once you leave for the day.' },
  { q: 'What is your cancellation policy?', a: 'Cancellation and rescheduling policies vary by booking type. Please review the policy shown when registering for a class or booking an event.' },
  { q: 'Do you offer food and drinks?', a: 'Yes! Our cafe will offer coffee and drinks and pre-packaged snacks.' },
  { q: 'Can I bring outside food?', a: 'Small snacks for children are welcome. Outside meals and takeout food are not permitted during Open Play. Exceptions may be made for specific dietary needs. Please be mindful with allergy-sensitive snacks and avoid bringing foods that may create allergy concerns for other families. Separate food policies apply to private parties and events.' },
  {
    q: 'Do you have memberships?',
    a: (
      <>
        Yes! Memberships include unlimited Open Play, up to two accompanying adults per visit, and priority registration
        for select classes and special events. Visit our <Link href="/membership">Membership page</Link> for pricing and
        details.
      </>
    ),
  },
  { q: 'What are your operating hours?', a: 'We plan to be open year-round: Sunday through Thursday from 9:00 AM to 6:00 PM, and Friday through Saturday from 9:00 AM to 7:00 PM. Hours may be adjusted based on demand.' },
  { q: 'How do you keep the space clean?', a: 'We clean and sanitize toys, play materials, and high-touch surfaces throughout the day and as needed.' },
  { q: 'Do we need socks?', a: 'Yes, socks are required for children and adults throughout the play area. Shoes are not permitted. Socks should be removed before entering the sand play area and put back on before returning to the rest of the play space.' },
  { q: 'Can I bring my child who is over 5 years old?', a: 'Children of all ages are welcome. However, our space is thoughtfully designed for younger children, and the experience is best suited for ages 0–5.' },
  { q: 'Will you offer calmer hours?', a: 'Yes, we plan to offer dedicated calmer sessions designed to create a more supportive environment for children with different needs.' },
] as const;

export default function FaqPage() {
  return (
    <main style={{ maxWidth: 980, margin: '20px auto', padding: 24, background: '#F7F4EF', border: '1px solid #ece2d8', borderRadius: 32 }}>
      <h1 style={{ margin: 0, color: '#A78BCB', fontSize: 'clamp(2rem,4vw,3rem)' }}>FAQ</h1>
      <p style={{ color: '#4A4A4A', maxWidth: 720, lineHeight: 1.8, marginTop: 12 }}>
        Quick answers to common questions from families visiting Little Wanderers Play Studio & Cafe in West Hartford, CT.
      </p>
      <section style={{ marginTop: 18, minWidth: 0 }}>{faqItems.map((item) => <QA key={item.q} q={item.q} a={item.a} />)}</section>
    </main>
  );
}
