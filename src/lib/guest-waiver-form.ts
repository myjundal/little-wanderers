import { z } from 'zod';
import { parseBirthdate } from '@/lib/birthdate';
import { WAIVER_AGREEMENTS, WAIVER_VERSION } from '@/lib/waiver-content';

export type ChildDraft = { first_name: string; last_name: string; birthdate: string };
export type FamilyDraft = { email: string; firstName: string; lastName: string; phone: string; children: ChildDraft[] };
export type WaiverDraft = FamilyDraft & { guardian: boolean; electronic: boolean; agreements: Record<string, boolean>; photo: string; signature: string };
export type FormIssue = { id: string; message: string };

export function validateGuestWaiver(draft: WaiverDraft): FormIssue[] {
  const issues: FormIssue[] = [];
  const add = (id: string, message: string) => issues.push({ id, message });
  if (!z.email().max(254).safeParse(draft.email.trim()).success) add('email', 'Enter a valid guardian email address.');
  if (!draft.firstName.trim()) add('first-name', 'Enter the guardian’s first name.');
  if (!draft.lastName.trim()) add('last-name', 'Enter the guardian’s last name.');
  const digits = draft.phone.replace(/\D/g, '');
  const phone = !draft.phone.trim().startsWith('+') && digits.length === 10 ? `1${digits}` : digits;
  if (!/^[1-9]\d{7,14}$/.test(phone)) add('phone', 'Enter a valid phone number, including the area code.');
  draft.children.forEach((child, index) => {
    if (!child.first_name.trim()) add(`child-${index}-first`, `Enter Child ${index + 1}’s first name.`);
    if (!child.last_name.trim()) add(`child-${index}-last`, `Enter Child ${index + 1}’s last name.`);
    if (!parseBirthdate(child.birthdate)) add(`child-${index}-birthday`, `Enter Child ${index + 1}’s birthday as MM/DD/YY or MM/DD/YYYY, with a date that is not in the future.`);
  });
  if (!draft.guardian) add('guardian', 'Confirm that you are the parent or legal guardian.');
  const agreementNames: Record<string, string> = { risk: 'play risks', supervision: 'supervision', illness: 'illness policy', materials: 'sensory materials', cameras: 'security cameras', release: 'release of liability', validity: '90-day validity' };
  WAIVER_AGREEMENTS.forEach(item => {
    if (!draft.agreements[item.id]) add(`agreement-${item.id}`, `Review and check the ${agreementNames[item.id]} agreement.`);
  });
  if (!['yes', 'no'].includes(draft.photo)) add('photo', 'Choose Yes or No for photo permission. Either choice is welcome.');
  if (draft.signature.trim().length < 2) add('signature', 'Type your full legal name to sign.');
  if (!draft.electronic) add('electronic', 'Confirm that your typed name is your electronic signature.');
  return issues;
}

// Only unfinished contact details are remembered. Consent and signature always start blank.
export function readFamilyDraft(raw: string | null, submissionId: string, now = Date.now()): FamilyDraft | null {
  try {
    const data = JSON.parse(raw || 'null');
    if (!data || data.submissionId !== submissionId || data.version !== WAIVER_VERSION || !(data.expires > now)) return null;
    const family = data.family;
    if (!family || !['email', 'firstName', 'lastName', 'phone'].every(key => typeof family[key] === 'string' && family[key].length <= 254)
      || !Array.isArray(family.children) || family.children.length < 1 || family.children.length > 10
      || !family.children.every((child: ChildDraft) => child && ['first_name', 'last_name', 'birthdate'].every(key => typeof child[key as keyof ChildDraft] === 'string' && child[key as keyof ChildDraft].length <= 100))) return null;
    return { email: family.email, firstName: family.firstName, lastName: family.lastName, phone: family.phone,
      children: family.children.map((child: ChildDraft) => ({ first_name: child.first_name, last_name: child.last_name, birthdate: child.birthdate })) };
  } catch { return null; }
}
