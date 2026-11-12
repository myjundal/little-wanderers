import { allocateRevenue, revenueDay, type RevenueEvidence, type RevenueService, type RevenueSources } from '@/lib/service-day-revenue';

/** A POS class purchase can be allocated without changing a customer's seat,
 * invoice or payment. Only persisted production catalog IDs establish a link.
 * Course names, equal prices and purchase dates never establish a class date. */
export function allocateCatalogClassRevenue(services: RevenueService[], receipts: RevenueEvidence[], sources: RevenueSources) {
  const result = [...services];
  const classes = new Map(sources.classes.map(row => [row.id, row]));
  const programs = new Map((sources.classPrograms ?? []).map(row => [row.id, row]));
  const mappings = sources.classMappings ?? [];
  for (const receipt of receipts) {
    // A website checkout/series already supplies the entire authoritative
    // class allocation. Do not add a second copy from its catalog label.
    if (services.some(row => row.category === 'class' && row.charges.some(charge => charge.order_id === receipt.order_id))) continue;
    for (const [index, item] of (receipt.items ?? []).entries()) {
      if (item.category !== 'class' || !item.catalog_object_id || item.amount_cents <= 0) continue;
      const matches = mappings.filter(row => row.variation_id === item.catalog_object_id);
      if (!matches.length) continue;
      const programKeys = [...new Set(matches.map(row => row.program_key))];
      let ids: string[];
      if (programKeys.length === 1 && programKeys[0]) {
        const program = programs.get(programKeys[0]);
        if (!program?.class_ids.length || new Set(program.class_ids).size !== program.class_ids.length
          || matches.some(row => !program.class_ids.includes(row.entity_key))) continue;
        ids = [...program.class_ids];
      } else {
        // A weekly class variation is reused across many dates. Only an exact
        // one-session mapping is sufficient without a selected-date checkout.
        const unique = [...new Set(matches.map(row => row.entity_key))];
        if (programKeys.length !== 1 || programKeys[0] || unique.length !== 1) continue;
        ids = unique;
      }
      if (ids.some(id => !classes.has(id) || !Number.isFinite(Date.parse(classes.get(id)!.start_time)))) continue;
      ids.sort((a, b) => classes.get(a)!.start_time.localeCompare(classes.get(b)!.start_time));
      const amounts = allocateRevenue(item.amount_cents, ids.map(() => 1));
      ids.forEach((id, position) => {
        const session = classes.get(id)!;
        result.push({ id: `catalog-class:${receipt.order_id}:${index}:${id}`, date: revenueDay(session.start_time), category: 'class',
          label: `${session.title} · 수업 ${position + 1}/${ids.length} · 현장 결제 ${receipt.order_id.slice(0, 8)}`,
          expected_cents: amounts[position], attendance: 'unknown', recognition: 'class_service', cancelled: session.status === 'cancelled',
          charges: [{ order_id: receipt.order_id, amount_cents: amounts[position] }], issues: [],
        });
      });
    }
  }
  return result;
}
