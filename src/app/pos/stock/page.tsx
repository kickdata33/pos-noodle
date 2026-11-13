import { PosPageGate } from "@/components/pos/PosPageGate";
import { StockScreen } from "@/components/pos/StockScreen";

export default function StockPage() {
  return (
    <PosPageGate page="/pos/stock">
      <StockScreen />
    </PosPageGate>
  );
}
