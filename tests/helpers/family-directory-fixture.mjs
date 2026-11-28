export function directoryAdmin(tables = {}, failTable = '') {
  const visited = [];
  return { visited, from(table) {
    let start = 0, end = Infinity;
    const sort = [];
    const q = {
      select() { return q; },
      order(key, { ascending = true } = {}) { sort.push([key, ascending]); return q; },
      range(from, to) { start = from; end = to; visited.push([table, from]); return q; },
      limit(value) { end = value - 1; return q; },
      then(resolve) {
        if (table === failTable) return resolve({ data: null, error: { message: 'Unavailable' } });
        const data = [...(tables[table] ?? [])].sort((a, b) => {
          for (const [key, ascending] of sort) {
            const compared = String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
            if (compared) return ascending ? compared : -compared;
          }
          return 0;
        }).slice(start, end + 1);
        resolve({ data, error: null });
      },
    };
    return q;
  } };
}
