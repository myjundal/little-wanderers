import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

// Poppins 폰트 설정 (굵기 옵션 포함 가능)
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"], // 필요에 따라 조절 가능
  display: "swap",
});

export const metadata = {
  title: {
    default: 'Little Wanderers',
    template: '%s — Little Wanderers',
  },
  description: 'Sensory & learning play adventure for kids and parents in West Hartford.',
  openGraph: {
    title: 'Little Wanderers',
    description: 'Play, learn, and wander in West Hartford.',
    url: process.env.NEXT_PUBLIC_SITE_URL,
    siteName: 'Little Wanderers',
    type: 'website',
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}

