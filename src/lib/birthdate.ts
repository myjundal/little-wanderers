/** Format digits while typing so phone number keyboards can enter a birthday. */
export function formatBirthdateInput(input: string) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  const digits = (iso ? `${iso[2]}${iso[3]}${iso[1]}` : input.replace(/\D/g, '')).slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

/** Accept the explicitly labeled US date format and existing ISO dates. */
export function parseBirthdate(input: string, today: Date = new Date()): string | null {
  const value = input.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const us = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(value);
  if (!iso && !us) return null;
  const year = Number(iso ? iso[1] : us![3]);
  const month = Number(iso ? iso[2] : us![1]);
  const day = Number(iso ? iso[3] : us![2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (date.toISOString().slice(0, 10) > today.toISOString().slice(0, 10)) return null;
  return date.toISOString().slice(0, 10);
}
