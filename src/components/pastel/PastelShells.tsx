import type { ReactNode } from 'react';

export function PastelPageShell({ children }: { children: ReactNode }) {
  return <div className="pastel-page-shell">{children}</div>;
}

export function PastelSection({ children }: { children: ReactNode }) {
  return <section className="pastel-section">{children}</section>;
}

export function PastelDashboardShell({ children }: { children: ReactNode }) {
  return <div className="pastel-dashboard-shell">{children}</div>;
}
