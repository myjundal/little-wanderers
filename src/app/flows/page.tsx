'use client';
import Link from 'next/link';

export default function FlowsPage() {
  // 이 페이지는 운영/개발용 요약 미리보기예요. 상세 다이어그램은 docs 파일을 확인하세요.
  const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="max-w-3xl rounded-2xl border p-5 mb-5 shadow-sm">
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      <div className="text-sm leading-6">{children}</div>
    </div>
  );

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold mb-4">Little Wanderers — Core UX Flows</h1>
      <p className="mb-6 text-sm">
        For detailed diagrams, see <code>docs/ux/user-flows.md</code>.
      </p>

      <Card title="A. Subscribe / Manage Monthly Membership">
        <ul className="list-disc pl-5">
          <li>Status check on dashboard → Subscribe/Resume CTA if not active</li>
          <li>Square Subscription → Webhook → Supabase membership upsert</li>
          <li>Dashboard reflects <em>webhook-verified</em> state</li>
        </ul>
      </Card>

      <Card title="B. On-site Check-in (Members Only)">
        <ul className="list-disc pl-5">
          <li>Find family via email/name/QR</li>
          <li>Gate: membership active &amp; latest waiver signed</li>
          <li>Insert Visit on success; otherwise prompt to subscribe/resume or sign waiver</li>
        </ul>
      </Card>

      <Card title="C. Class Browse / Book / Cancel">
        <ul className="list-disc pl-5">
          <li>Schedule → seat availability → booking</li>
          <li>Included-with-membership or paid add-ons via Square + webhook</li>
          <li>Manage in “My Classes”</li>
        </ul>
      </Card>

      <Card title="D. Staff Roster & Attendance">
        <ul className="list-disc pl-5">
          <li>Load roster and mark present/no-show/late</li>
        </ul>
      </Card>

      <Card title="Edge Cases & Policies">
        <ul className="list-disc pl-5">
          <li>Subscription state: active/paused/canceled</li>
          <li>Capacity guard on live occupancy</li>
          <li>Chargebacks/refunds reflected via webhook</li>
          <li>Family-level membership; per-child visit tracking</li>
          <li>Waiver gating on version change</li>
        </ul>
      </Card>

      <div className="mt-8">
        <Link className="underline" href="/">← Back to Home</Link>
      </div>
    </main>
  );
}

