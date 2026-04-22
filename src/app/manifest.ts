import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Little Wanderers',
    short_name: 'Little Wanderers',
    description: 'Family play space scheduling and check-in.',
    start_url: '/landing',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#6d4bb7',
    icons: [
      {
        src: '/logo.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
