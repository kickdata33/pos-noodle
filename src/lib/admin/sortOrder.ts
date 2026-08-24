/**
 * Shared "move up/down" logic for the Admin list pages (categories, tables, channels, payment
 * methods, modifier groups/options). Each list is sorted client-side by `sortOrder asc` (the
 * repositories already query that way); moving an item swaps its `sortOrder` with its neighbor's.
 *
 * Pure function so it's testable and reusable without depending on Firestore — the caller is
 * responsible for persisting the two returned {id, sortOrder} pairs.
 */
export interface Sortable {
  id: string;
  sortOrder: number;
}

export function computeSwap<T extends Sortable>(
  items: T[],
  index: number,
  direction: "up" | "down"
): [Sortable, Sortable] | null {
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= items.length) return null;

  const current = items[index];
  const target = items[targetIndex];

  return [
    { id: current.id, sortOrder: target.sortOrder },
    { id: target.id, sortOrder: current.sortOrder },
  ];
}
