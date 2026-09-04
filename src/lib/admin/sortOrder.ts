/**
 * Shared "move up/down" logic for the Admin list pages (categories, products, tables, channels,
 * payment methods, modifier groups/options). Each list is sorted client-side by `sortOrder asc`
 * (the repositories already query that way).
 *
 * Pure function so it's testable and reusable without depending on Firestore — the caller is
 * responsible for persisting every returned {id, sortOrder} pair (every item in the list, not
 * just the two that moved — see the comment inline below for why).
 */
export interface Sortable {
  id: string;
  sortOrder: number;
}

export function computeSwap<T extends Sortable>(
  items: T[],
  index: number,
  direction: "up" | "down"
): Sortable[] | null {
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= items.length) return null;

  const reordered = [...items];
  [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

  // Renumber the *whole* list to its new array position (0..n-1) rather than swapping just the
  // two `sortOrder` values that moved. A list can end up with duplicate `sortOrder`s — e.g. an
  // "add" flow that computed the next value from `items.length` while two clicks landed before
  // either write's Firestore snapshot came back — and swapping two items that happen to already
  // share the same value is a no-op write: nothing changes, so "move up" visibly does nothing
  // (reported bug: last few rows of a list couldn't reorder). Writing every item's position back
  // as clean, distinct 0..n-1 values self-heals that the first time anyone clicks any arrow in
  // the affected list, and prevents it from recurring.
  return reordered.map((item, i) => ({ id: item.id, sortOrder: i }));
}
