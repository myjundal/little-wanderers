# Email code login rollout

The login screen accepts a six-digit email OTP and preserves the original booking destination. SMS remains four digits, matching the existing screen. No schema or environment-variable changes are needed.

## Required Supabase settings before merging

In the existing production Supabase project, open Authentication → Email Templates.

1. Set **Magic Link** subject to `Your Little Wanderers sign-in code` and replace its body with the complete HTML in `auth-email-code.html`.
2. Set **Confirm signup** subject and body to the same values. New users receive this template; existing users receive Magic Link.
3. Check that Email OTP length is **6** in Authentication → Sign In / Providers → Email. Preserve the existing SMS OTP length (4). Do not guess the production configuration.
4. Save both templates, then deploy the login change immediately. Templates and the application must be rolled out together: the old screen asks for a link, and the new screen asks for a code.

`{{ .Token }}` is expanded by Supabase. Do not replace it with a fixed number. This template deliberately contains no authentication link, so inbox link scanning cannot consume the credential. Keep the existing link/callback routes for emails already in flight.

## Verify in production

- Existing account: request an email code, paste all six digits, select Sign in, and confirm return to `/landing/party` or `/landing/classes` as requested.
- New email: choose I am new, request a code, confirm receipt of the signup template, enter the code, and check household/Wanderlist claiming and return to the booking page.
- Open the email on another device and enter the code in the original browser; no browser-dependent link exchange is involved.
- Wrong/expired code: show an error, allow editing and retry, and do not automatically repeat verification requests.
- Resend: wait for cooldown, receive a new code, clear the old input, use newest code. Reloading or switching account/method buttons must not bypass the cooldown.
- Existing phone account: four-digit SMS code and return destination still work.

Live delivery and production OTP length cannot be verified from the repository alone.

## Rollback

Revert the application change and restore both saved email templates together. Save the current production subjects and bodies before replacing them.

References: https://supabase.com/docs/guides/auth/auth-email-passwordless and https://supabase.com/docs/guides/auth/auth-email-templates
