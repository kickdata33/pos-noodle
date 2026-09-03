import { OrderScreen } from "@/components/pos/OrderScreen";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ tableId?: string; channelId?: string }>;
}) {
  const { orderId } = await params;
  const sp = await searchParams;

  return (
    <OrderScreen
      orderId={orderId === "new" ? null : orderId}
      initialTableId={sp.tableId ?? null}
      initialChannelId={sp.channelId ?? null}
    />
  );
}
