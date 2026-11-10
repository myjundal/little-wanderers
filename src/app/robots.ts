export default function robots() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/landing/', '/api/'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}

