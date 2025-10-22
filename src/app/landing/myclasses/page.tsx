'use client';
import Link from 'next/link';

export default function MyClassesPage() {
  return (
    <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>
        My Classes
      </h1>
      <p style={{ color: '#555', marginBottom: 24 }}>
        This page will list your booked or completed classes.
      </p>

      <div
        style={{
          padding: 16,
          border: '1px dashed #ccc',
          borderRadius: 12,
          textAlign: 'center',
          background: '#fafafa',
        }}
      >
        <p>No classes booked yet.</p>
        <p style={{ marginTop: 8 }}>
          <Link
            href="/landing/classschedule"
            style={{
              textDecoration: 'underline',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            View class schedule →
          </Link>
        </p>
      </div>
    </main>
  );
}

