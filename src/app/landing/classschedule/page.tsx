'use client';
import Link from 'next/link';

export default function ClassSchedulePage() {
  return (
    <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>
        Class Schedule
      </h1>
      <p style={{ color: '#555', marginBottom: 24 }}>
        This page will show upcoming class times and activities.
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
        <p>Class schedule coming soon!</p>
        <p style={{ marginTop: 8 }}>
          <Link
            href="/landing/myclasses"
            style={{
              textDecoration: 'underline',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Back to My Classes
          </Link>
        </p>
      </div>
    </main>
  );
}

