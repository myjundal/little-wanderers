import { z } from 'zod';
import { parseBirthdate } from '@/lib/birthdate';

const name = z.string().trim().max(80);
export const familyPersonSchema = z.object({
  first_name: name.min(1, 'Please enter a first name.'),
  last_name: name.nullable().transform(value => value || null),
  gender: z.enum(['female', 'male', 'non_binary', 'prefer_not_to_say']).nullable(),
  birthdate: z.string().nullable().refine(value => !value || parseBirthdate(value) !== null, 'Please enter a valid birthday that is not in the future.').transform(value => value ? parseBirthdate(value) : null),
});

export const familyContactSchema = z.object({
  phone: z.string().trim().nullable().refine(value => !value || /^\+1\d{10}$/.test(value), 'Please enter a valid US phone number.').transform(value => value || null),
  city: z.string().trim().max(100).nullable().transform(value => value || null),
  state: z.enum(['CT', 'MA', 'NY', 'RI', 'NJ', 'NH', 'VT', 'ME']),
});

export const FAMILY_PERSON_SELECT = 'id,role,first_name,last_name,gender,birthdate';
