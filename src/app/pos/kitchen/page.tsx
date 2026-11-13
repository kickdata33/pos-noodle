import { KitchenScreen } from "@/components/pos/KitchenScreen";
import { PosPageGate } from "@/components/pos/PosPageGate";

export default function KitchenPage() {
  return (
    <PosPageGate page="/pos/kitchen">
      <KitchenScreen />
    </PosPageGate>
  );
}
