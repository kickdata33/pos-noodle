import { PosPageGate } from "@/components/pos/PosPageGate";
import { PrintStationScreen } from "@/components/pos/PrintStationScreen";

export default function PrintStationPage() {
  return (
    <PosPageGate page="/pos/print-station">
      <PrintStationScreen />
    </PosPageGate>
  );
}
