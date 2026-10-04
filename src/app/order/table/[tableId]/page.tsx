import { CustomerOrderScreen } from "@/components/customer/CustomerOrderScreen";

/**
 * Public QR self-order screen — intentionally outside `/pos` and `/admin`, so it picks up no
 * auth gate (this app has no global middleware; each of those trees gates itself in its own
 * `layout.tsx`). Reachable by anyone who scans the table's QR code, no PIN required.
 *
 * `?s=` carries a `qrMode: "session"` table's one-time token (see `Table.sessionToken`'s own
 * comment) — absent for an ordinary `"static"` table's permanent link, so this stays a no-op for
 * every shop not using that feature.
 */
export default async function CustomerOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ tableId: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { tableId } = await params;
  const { s } = await searchParams;
  return <CustomerOrderScreen tableId={tableId} sessionToken={s ?? null} />;
}
