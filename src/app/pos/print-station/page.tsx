import { PrintStationScreen } from "@/components/pos/PrintStationScreen";

/**
 * No `PosPageGate` here (unlike the other secondary `/pos/*` screens) — see `posPages.ts`'s
 * comment on why this page was pulled out of `POS_SECONDARY_PAGES`. Reachable by any signed-in
 * staff/admin, same tier as the table grid and the order screen; `pos/layout.tsx`'s own gate
 * still requires being signed in.
 */
export default function PrintStationPage() {
  return <PrintStationScreen />;
}
