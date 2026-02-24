export default async function sitemap() {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return [
    { url: `${base}/`, changefreq: 'weekly', priority: 1.0 },
    { url: `${base}/pricing`, changefreq: 'monthly', priority: 0.8 },
    { url: `${base}/faq`, changefreq: 'monthly', priority: 0.6 },
    { url: `${base}/app`, changefreq: 'weekly', priority: 0.5 },
  ];
}

