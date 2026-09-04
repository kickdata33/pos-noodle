import { ArrowLeft } from "lucide-react";
import Link from "next/link";

/**
 * Small "‹ กลับ" link back to `/pos`, shared by every `/pos/*` sub-screen (history, stock,
 * alert-voice, …) that isn't the home grid itself. These pages have no browser-chrome back
 * button of their own (staff devices are often full-screen PWAs/kiosk tablets), so without this
 * the only way back was the phone/tablet's own back button — easy to miss, and on some kiosk
 * setups not present at all.
 */
export function PosBackLink() {
  return (
    <Link
      href="/pos"
      className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      กลับ
    </Link>
  );
}
