/**
 * Pure generation logic behind `BulkCreateTablesDialog` (item 13: "สร้างโต๊ะทีละหลายใบ") — kept
 * separate from the component the same way `computeSwap` is, so the actual numbering logic is
 * readable/reviewable on its own without any Firestore or dialog-state code around it.
 */
export interface BulkTableSpec {
  /** How many tables to create — the caller validates this is a positive integer within a sane
   * cap before calling (the dialog itself enforces 1–300). */
  count: number;
  /** The number the first table gets; the rest are sequential from here (`startNumber + 1`,
   * `startNumber + 2`, …) regardless of layout — see `snake` below for what *does* change. */
  startNumber: number;
  /** Table name template — `{n}` is replaced with the table's number (e.g. `"โต๊ะ {n}"` →
   * `"โต๊ะ 1"`). A template with no `{n}` has the number appended instead, so a blank/plain
   * template still produces distinct names rather than `count` identical ones. */
  nameTemplate: string;
  /** How many tables make up one physical row — only meaningful with `snake: true`. */
  perRow: number | null;
  /**
   * Boustrophedon ("snake") layout: when tables are physically arranged in rows of `perRow` with
   * every other row running the opposite direction — the common restaurant-floor layout where
   * two facing rows end up with adjacent table *numbers* actually sitting next to each other —
   * this reverses the *creation/display order* within every odd row, not the numbers themselves.
   * Row 1 still reads 1..10 left to right; row 2 reads 20..11 left to right, so table 10 and
   * table 11 end up adjacent in the generated order (and so in the POS table grid, which lays
   * tables out in that same order — see `PosHome.tsx`'s own grid).
   */
  snake: boolean;
}

export interface GeneratedTable {
  name: string;
  /** 0-based position within this batch — the caller adds the shop's existing table count to
   * get each table's real `sortOrder`. */
  sortOrderOffset: number;
}

function nameFor(template: string, n: number): string {
  return template.includes("{n}") ? template.replace("{n}", String(n)) : `${template}${n}`;
}

export function generateBulkTables(spec: BulkTableSpec): GeneratedTable[] {
  const { count, startNumber, nameTemplate, perRow, snake } = spec;

  // `numberOffsets[k]` is which *number* (relative to `startNumber`) lands at creation-order slot
  // `k`. Without snaking this is just identity (slot 0 → +0, slot 1 → +1, …) — snaking re-groups
  // it into `perRow`-sized rows and reverses every other one before flattening back out.
  let numberOffsets = Array.from({ length: count }, (_, k) => k);
  if (snake && perRow && perRow > 0) {
    const rows: number[][] = [];
    for (let i = 0; i < numberOffsets.length; i += perRow) rows.push(numberOffsets.slice(i, i + perRow));
    rows.forEach((row, r) => {
      if (r % 2 === 1) row.reverse();
    });
    numberOffsets = rows.flat();
  }

  return numberOffsets.map((numberOffset, sortOrderOffset) => ({
    name: nameFor(nameTemplate, startNumber + numberOffset),
    sortOrderOffset,
  }));
}
