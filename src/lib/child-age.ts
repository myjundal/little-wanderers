type AgeUnit = 'months' | 'years';

export function parseChildAge(value: unknown, unitValue: unknown): { months: number; label: string } | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const age = Number(value);
  const unit: AgeUnit | null =
    unitValue === undefined || unitValue === null
      ? 'years'
      : unitValue === 'months' || unitValue === 'years'
      ? unitValue
      : null;
  if (!unit) return null;
  if (!Number.isFinite(age) || age < 0 || age > (unit === 'months' ? 144 : 12)) return null;
  if (unit === 'months') {
    const months = Math.round(age);
    if (months > 144) return null;
    return { months, label: `${months} ${months === 1 ? 'month' : 'months'}` };
  }
  const roundedYears = Math.round(age * 2) / 2;
  if (roundedYears > 12) return null;
  const months = Math.round(roundedYears * 12);
  return { months, label: `${roundedYears} ${roundedYears === 1 ? 'year' : 'years'}` };
}

