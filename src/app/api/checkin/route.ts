import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type PersonRow = {
  id: string;
  household_id: string;
  role: 'adult' | 'child';
  first_name: string | null;
  last_name: string | null;
  birthdate: string | null;
};

type PricingRule = {
  id: string;
  role: 'adult' | 'child' | null;
  min_months: number | null;
  max_months: number | null;
  price_cents: number;
  active_from: string | null;
  active_to: string | null;
};

function monthsBetween(birthISO: string | null): number | null {
  if (!birthISO) return null;
  const b = new Date(birthISO);
  const now = new Date();
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth());
  if (now.getDate() < b.getDate()) months -= 1;
  return Math.max(months, 0);
}

function ruleApplies(rule: PricingRule, role: 'adult' | 'child', ageMonths: number | null): boolean {
  const today = new Date();
  const af = rule.active_from ? new Date(rule.active_from) : null;
  const at = rule.active_to ? new Date(rule.active_to) : null;
  if (af && af > today) return false;
  if (at && at < new Date(today.toDateString())) return false; // end date past
  if (rule.role && rule.role !== role) return false;
  if (rule.min_months != null) {
    if (ageMonths == null || ageMonths < rule.min_months) return false;
  }
  if (rule.max_months != null) {
    if (ageMonths == null || ageMonths > rule.max_months) return false;
  }
  return true;
}

function pickBestRule(rules: PricingRule[], role: 'adult' | 'child', ageMonths: number | null): PricingRule | null {
  const candidates = rules.filter(r => ruleApplies(r, role, ageMonths));
  if (candidates.length === 0) return null;

  // Priority: role-specific > narrower range > newer active_from
  return candidates.sort((a, b) => {
    const aRole = a.role ? 1 : 0;
    const bRole = b.role ? 1 : 0;
    if (bRole !== aRole) return bRole - aRole;

    const aSpan = ( (a.max_months ?? 99999) - (a.min_months ?? 0) );
    const bSpan = ( (b.max_months ?? 99999) - (b.min_months ?? 0) );
    if (aSpan !== bSpan) return aSpan - bSpan;

    const aFrom = a.active_from ? new Date(a.active_from).getTime() : 0;
    const bFrom = b.active_from ? new Date(b.active_from).getTime() : 0;
    return bFrom - aFrom;
  })[0];
}

export async function POST(req: NextRequest) {
  try {
    const { person_id, source = 'qr' } = await req.json();

    if (!person_id) {
      return new Response(JSON.stringify({ ok: false, error: 'person_id required' }), { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!  // server-only; bypasses RLS
    );

    // 1) Load person
    const { data: person, error: personErr } = await supabaseAdmin
      .from('people')
      .select('id, household_id, role, first_name, last_name, birthdate')
      .eq('id', person_id)
      .maybeSingle();

    if (personErr || !person) {
      return new Response(JSON.stringify({ ok: false, error: 'person not found' }), { status: 404 });
    }

    // 2) Membership check (household OR person, status=active, renews_at null or future)
    const nowISO = new Date().toISOString();
    const { data: memberships, error: memErr } = await supabaseAdmin
      .from('memberships')
      .select('id')
      .or(`household_id.eq.${(person as PersonRow).household_id},person_id.eq.${person_id}`)
      .eq('status', 'active')
      .or(`renews_at.is.null,renews_at.gt.${nowISO}`);

    if (memErr) {
      return new Response(JSON.stringify({ ok: false, error: 'membership check failed' }), { status: 500 });
    }

    let price_cents = 0;
    let membership_applied = false;

    if (memberships && memberships.length > 0) {
      membership_applied = true;
      price_cents = 0;
    } else {
      // 3) Load pricing rules and pick best
      const { data: rules, error: rulesErr } = await supabaseAdmin
        .from('pricing_rules')
        .select('*');

      if (rulesErr) {
        return new Response(JSON.stringify({ ok: false, error: 'pricing rules load failed' }), { status: 500 });
      }

      const ageMonths = monthsBetween((person as PersonRow).birthdate);
      const best = pickBestRule(rules as PricingRule[], (person as PersonRow).role, ageMonths);

      if (!best) {
        return new Response(JSON.stringify({ ok: false, error: 'no applicable pricing rule' }), { status: 422 });
      }

      price_cents = best.price_cents;
    }

    // 4) Insert checkin
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('checkins')
      .insert({
        person_id,
        source,
        price_cents,
        membership_applied,
        notes: null
      })
      .select('id')
      .maybeSingle();

    if (insErr) {
      return new Response(JSON.stringify({ ok: false, error: 'insert failed' }), { status: 500 });
    }

    return new Response(JSON.stringify({
      ok: true,
      checkin_id: inserted?.id,
      membership_applied,
      price_cents,
      first_name: person.first_name,
      last_name: person.last_name,
      birthdate: person.birthdate
    }), { status: 200 });

  } catch (e: unknown) {
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? 'unknown error' }), { status: 500 });
  }
}

