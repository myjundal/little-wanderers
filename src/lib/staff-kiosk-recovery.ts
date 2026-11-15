import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/** Called only after the registered device, PIN and current staff role are verified. */
export async function resumeKioskShift(admin: SupabaseClient, input: {
  userId: string; deviceId: string; sessionHash: string; pinVersion: number;
}) {
  const { data: shift, error } = await admin.from('staff_time_entries')
    .select('id,clock_in,session_hash').eq('user_id', input.userId).is('clock_out', null).maybeSingle();
  if (error) throw new Error('Unable to check your open shift. Please try again.');
  if (!shift) return null;

  const { data: previous, error: sessionError } = await admin.from('staff_kiosk_sessions')
    .select('expires_at').eq('token_hash', shift.session_hash).maybeSingle();
  if (sessionError) throw new Error('Unable to check your shift session. Please try again.');
  if (!previous || new Date(previous.expires_at).getTime() <= Date.now()) {
    throw new Error('Your previous shift has expired. Ask the owner to resolve the open timecard before clocking in.');
  }

  // A replacement session has no access until it owns the existing open timecard.
  // Preserve the original expiry as well as clock-in; recovery does not extend a shift.
  const { error: createError } = await admin.from('staff_kiosk_sessions').insert({
    token_hash: input.sessionHash, user_id: input.userId, device_id: input.deviceId,
    pin_version: input.pinVersion, expires_at: previous.expires_at,
  });
  if (createError) throw new Error('Unable to restore your shift. Please try again.');

  // Compare-and-swap protects a concurrent clock-out or another recovery. Existing
  // unique indexes also prevent taking an iPad with another employee's open shift.
  const { data: moved, error: moveError } = await admin.from('staff_time_entries')
    .update({ session_hash: input.sessionHash, device_id: input.deviceId })
    .eq('id', shift.id).eq('session_hash', shift.session_hash).is('clock_out', null).select('id');
  if (moveError || !moved?.length) {
    await admin.from('staff_kiosk_sessions').update({ revoked_at: new Date().toISOString() }).eq('token_hash', input.sessionHash);
    throw new Error(moveError?.code === '23505'
      ? 'The previous employee must clock out on this iPad first.'
      : 'Your shift changed while signing in. Refresh and try again.');
  }

  // The old token already fails getKioskIdentity because it no longer owns an open
  // timecard. Revocation and counter cleanup complete the successful PIN login.
  const results = await Promise.all([
    admin.from('staff_kiosk_sessions').update({ revoked_at: new Date().toISOString() }).eq('token_hash', shift.session_hash),
    admin.from('staff_profiles').update({ failed_attempts: 0, locked_until: null }).eq('user_id', input.userId),
    admin.from('staff_kiosk_devices').update({ failed_attempts: 0, locked_until: null }).eq('id', input.deviceId),
  ]);
  if (results.some(result => result.error)) logger.warn({ action: 'staff_shift_recovery_cleanup_failed' });
  return { ok: true as const, clock_in: shift.clock_in, resumed: true };
}
