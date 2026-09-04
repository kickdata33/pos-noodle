import { CustomerOrderScreen } from "@/components/customer/CustomerOrderScreen";

/**
 * Public QR self-order screen — intentionally outside `/pos` and `/admin`, so it picks up no
 * auth gate (this app has no global middleware; each of those trees gates itself in its own
 * `layout.tsx`). Reachable by anyone who scans the table's QR code, no PIN required.
 */
export default async function CustomerOrderPage({ params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  return <CustomerOrderScreen tableId={tableId} />;
}
