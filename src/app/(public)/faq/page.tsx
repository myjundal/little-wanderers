export const metadata = { title: 'FAQ — Little Wanderers' };

function QA({ q, a }: { q: string; a: string }) {
  return (
    <div style={{margin:'16px 0'}}>
      <p style={{fontWeight:600}}>{q}</p>
      <p>{a}</p>
    </div>
  );
}

export default function FaqPage() {
  return (
    <main>
      <h1>FAQ</h1>
      <QA q="Do I need to book in advance?" a="Walk-ins are welcome, but to control the capacity, booking ahead is 
recommended. Parties/classes will require booking." />
      <QA q="Do you have memberships?" a="Yes, we offer monthly memberships." />
      <QA q="Is there a café menu?" a="We offer hot and cold drinks for adults, and kid-friendly snacks and drinks. Full 
menu coming soon." />
      <QA q="Where are you located?" a="West Hartford, CT." />
    </main>
  );
}

