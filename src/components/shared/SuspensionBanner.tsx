import Link from "next/link";

/**
 * Non-dismissable warning shown inside `/admin` and `/pos` while a shop's subscription is
 * `past_due` (a charge failed, still inside its 3-day grace window — access is NOT blocked yet,
 * see the layouts' gate). This is the only feasible notification channel for Phase 3 v1: no
 * email/SMS infra exists in this codebase, confirmed during planning — a known limitation, not
 * an oversight.
 */
export function SuspensionBanner({ daysLeft }: { daysLeft: number | null }) {
  return (
    <div className="bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
      การตัดบัตรล้มเหลว กรุณาอัปเดตบัตรของร้าน
      {daysLeft !== null && ` ภายใน ${daysLeft} วัน มิฉะนั้นระบบจะถูกระงับ`}
      {" — "}
      <Link href="/billing" className="font-medium underline">
        ไปหน้าชำระเงิน
      </Link>
    </div>
  );
}
