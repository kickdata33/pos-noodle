import { AlertVoiceSettings } from "@/components/pos/AlertVoiceSettings";
import { PosPageGate } from "@/components/pos/PosPageGate";

export default function AlertVoicePage() {
  return (
    <PosPageGate page="/pos/alert-voice">
      <AlertVoiceSettings />
    </PosPageGate>
  );
}
