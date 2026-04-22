# Push notifications feasibility (April 22, 2026)

## Current stack fit
- The app runs on Next.js + Supabase, which can support standards-based Web Push.
- This pass adds:
  - browser permission prompt UI
  - service worker push handling
  - secure subscription storage in Supabase (`push_subscriptions`)
  - backend sending via VAPID (`web-push`)
  - occupancy-triggered sends with cooldown dedupe

## Platform notes
- **Android Chrome / desktop Chromium**: fully supported in browser and installed PWA.
- **iOS/iPadOS Safari**: push is supported for installed web apps on modern iOS, but users must install and grant permission first.
- **Non-installed iOS browser tab**: notification behavior may be limited compared to installed app mode.

## Rollout recommendations
1. Configure VAPID keys in Vercel env.
2. Ship with moderate cooldown (45+ minutes) and monitor engagement.
3. Add preference controls (quiet hours / per-household toggles) in a follow-up.
4. Implement invite acceptance and richer push targeting in a follow-up.
