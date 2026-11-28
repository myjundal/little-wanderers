import type { SupabaseClient } from '@supabase/supabase-js';

/** Directory counts and search must use every page, including older canonical families. */
export async function readFamilyDirectoryRows<T>(admin: SupabaseClient, table: string, fields: string, key = 'id'): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    let request = admin.from(table).select(fields).order(key);
    if (table === 'user_roles') request = request.order('role');
    const { data, error } = await request.range(offset, offset + 499);
    if (error || !data) throw new Error(`Unable to load family directory: ${table}`);
    rows.push(...(data as unknown as T[]));
    if (data.length < 500) return rows;
  }
}
