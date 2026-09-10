import { PickupOrderScreen } from "@/components/customer/PickupOrderScreen";

/**
 * Public self-order takeaway screen — one QR the shop prints/displays once for the whole
 * counter (not per-table, contrast `/order/table/[tableId]`). Same "no auth gate" reasoning as
 * that screen: outside `/pos` and `/admin`, so it never hits either tree's `layout.tsx` gate.
 */
export default function PickupOrderPage() {
  return <PickupOrderScreen />;
}
