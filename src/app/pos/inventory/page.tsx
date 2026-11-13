import { InventoryScreen } from "@/components/pos/InventoryScreen";
import { PosPageGate } from "@/components/pos/PosPageGate";

export default function InventoryPage() {
  return (
    <PosPageGate page="/pos/inventory">
      <InventoryScreen />
    </PosPageGate>
  );
}
