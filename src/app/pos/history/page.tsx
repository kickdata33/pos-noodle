import { OrderHistory } from "@/components/pos/OrderHistory";
import { PosPageGate } from "@/components/pos/PosPageGate";

export default function OrderHistoryPage() {
  return (
    <PosPageGate page="/pos/history">
      <OrderHistory />
    </PosPageGate>
  );
}
