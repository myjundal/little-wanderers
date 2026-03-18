import Link from 'next/link';

export default function ComingSoonPage({
  title,
  eyebrow,
}: {
  title: string;
  eyebrow: string;
}) {
  return (
    <main
      style={{
        maxWidth: 860,
        margin: '20px auto',
        padding: 28,
        borderRadius: 32,
        border: '1px solid rgba(255,255,255,0.7)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(246,241,255,0.9) 100%)',
        boxShadow: '0 24px 50px rgba(123, 106, 168, 0.1)',
      }}
    >
      <p
        style={{
          margin: 0,
          color: '#7b6aa8',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {eyebrow}
      </p>
      <h1 style={{ margin: '14px 0 0', color: '#4b4360', fontSize: 'clamp(2.2rem, 5vw, 3.2rem)' }}>{title}</h1>
      <p style={{ margin: '18px 0 0', color: '#7e7695', maxWidth: 580, lineHeight: 1.75 }}>
        Coming soon.
      </p>
      <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link
          href="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 52,
            padding: '0 22px',
            borderRadius: 999,
            background: 'linear-gradient(180deg, #8a79b7 0%, #6f5f99 100%)',
            color: '#fbf8ff',
            fontWeight: 700,
          }}
        >
          Back Home
        </Link>
      </div>
    </main>
  );
}
