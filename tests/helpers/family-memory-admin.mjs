export function memoryAdmin(tables, users = {}) {
  const writes = [];
  let fail = '';
  return { writes, tables, failNext(table) { fail = table; },
    auth: { admin: { getUserById: async id => ({ data: { user: users[id] }, error: null }) } },
    from(table) {
      if (!(table in tables)) throw Error('Unexpected table ' + table);
      const filters = []; let action = '', value, one = false, upsertOptions;
      const q = {
        select() { return q; }, order() { return q; }, limit() { return q; },
        eq(key, value) { filters.push(row => row[key] === value); return q; },
        is(key, value) { filters.push(row => row[key] === value); return q; },
        gte(key, value) { filters.push(row => row[key] >= value); return q; },
        in(key, values) { filters.push(row => values.includes(row[key])); return q; },
        not(key, op, value) { if (op !== 'is') throw Error(op); filters.push(row => row[key] !== value); return q; },
        update(v) { action = 'update'; value = v; return q; },
        upsert(v, options) { action = 'upsert'; value = v; upsertOptions = options; return q; },
        maybeSingle() { one = true; return q; }, single() { one = true; return q; },
        then(resolve) {
          if (fail === table) { fail = ''; return resolve({ data: null, error: { message: 'temporary write failure' } }); }
          let rows = tables[table].filter(row => filters.every(test => test(row)));
          if (action === 'update') { writes.push({ table, action, value: structuredClone(value) }); rows.forEach(row => Object.assign(row, structuredClone(value))); }
          if (action === 'upsert') {
            const key = upsertOptions.onConflict;
            if (!tables[table].some(row => row[key] === value[key])) tables[table].push(structuredClone(value));
            writes.push({ table, action, value: structuredClone(value) });
          }
          resolve({ data: structuredClone(one ? rows[0] ?? null : rows), error: null });
        },
      }; return q;
    },
  };
}
