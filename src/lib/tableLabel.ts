/**
 * "โต๊ะ 3" for a table named "3" — but a table already named "โต๊ะ 3" (some shops type the word
 * into the name) stays "โต๊ะ 3", never "โต๊ะ โต๊ะ 3". Every screen, ticket, receipt and message that
 * shows a table goes through this.
 */
export function tableLabel(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return /^โต๊ะ/.test(trimmed) ? trimmed : `โต๊ะ ${trimmed}`;
}
