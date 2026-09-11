"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

import { ModifierPickerDialog } from "@/components/pos/ModifierPickerDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { computeLineTotal } from "@/lib/pos/pricing";
import type { Category, ModifierGroup, ModifierOption, OrderItemModifier, Product } from "@/types";

interface MenuResponse {
  categories: Category[];
  products: Product[];
  modifierGroups: ModifierGroup[];
  modifierOptions: ModifierOption[];
  currency: string;
  promptPayAvailable: boolean;
  pickupIdentificationMode: "queue" | "name";
}

interface CartLine {
  key: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  modifiers: OrderItemModifier[];
  note: string;
  lineTotal: number;
}

interface SubmitResult {
  customerLabel: string;
  total: number;
  paymentIntent: "cash" | "transfer";
  promptPayPayload: string | null;
}

type Status = "loading" | "ready" | "error";
/** `"cart"` is the normal browsing screen; `"checkout"` is the identify/payment-choice dialog;
 * `"done"` replaces the whole screen with the confirmation + (if transfer) PromptPay QR. */
type Step = "cart" | "checkout" | "done";

/**
 * Self-order takeaway screen (`/order/pickup`) — one QR the shop prints once for the whole
 * counter, not per-table (contrast `CustomerOrderScreen`, which is dine-in and always tied to a
 * `tableId`). Every submission here is a brand-new order — there's no "add to my existing bill"
 * concept without a table or a login to tie repeat visits together — and identifies itself to
 * staff with either an auto-issued queue number or a typed name (`ShopSettings
 * .pickupIdentificationMode`), decided and enforced server-side (see the API route's comment).
 */
export function PickupOrderScreen() {
  const [status, setStatus] = useState<Status>("loading");
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);

  const [step, setStep] = useState<Step>("cart");
  const [customerName, setCustomerName] = useState("");
  const [paymentIntent, setPaymentIntent] = useState<"cash" | "transfer">("cash");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [transferNotified, setTransferNotified] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/customer/menu")
      .then((res) => res.json())
      .then((data: MenuResponse) => {
        if (cancelled) return;
        setMenu(data);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Renders the PromptPay payload the API returned into an actual scannable image — same
  // technique as `TableQrDialog` (the `qrcode` package draws to a canvas/data URL entirely in
  // the browser, no external QR-image service).
  useEffect(() => {
    if (!result?.promptPayPayload) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizing with the `qrcode` canvas draw below, not deriving from props; see TableQrDialog's identical comment
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(result.promptPayPayload, { width: 320, margin: 2 }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [result]);

  const activeCategories = useMemo(() => menu?.categories ?? [], [menu]);
  const currentCategoryId = activeCategoryId ?? activeCategories[0]?.id ?? null;
  const visibleProducts = useMemo(
    () => (menu?.products ?? []).filter((p) => p.categoryId === currentCategoryId),
    [menu, currentCategoryId]
  );
  const currency = menu?.currency ?? "THB";

  function addToCart(product: Product, quantity: number, modifiers: OrderItemModifier[], note: string) {
    setCart((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        productId: product.id,
        productName: product.name,
        quantity,
        unitPrice: product.price,
        modifiers,
        note,
        lineTotal: computeLineTotal(product.price, modifiers, quantity),
      },
    ]);
  }

  function handleProductTap(product: Product) {
    if (!product.active) return;
    if (product.modifierGroupIds.length > 0) {
      setPickerProduct(product);
    } else {
      addToCart(product, 1, [], "");
    }
  }

  function removeFromCart(key: string) {
    setCart((prev) => prev.filter((line) => line.key !== key));
  }

  const cartTotal = cart.reduce((sum, line) => sum + line.lineTotal, 0);
  const needsName = menu?.pickupIdentificationMode === "name";
  const canConfirm = !needsName || customerName.trim().length > 0;

  async function handleConfirmOrder() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/customer/pickup/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            optionIds: line.modifiers.map((m) => m.optionId),
            note: line.note,
          })),
          customerName: needsName ? customerName.trim() : undefined,
          paymentIntent,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        orderId?: string;
        customerLabel?: string;
        total?: number;
        promptPayPayload?: string | null;
      };
      if (!response.ok || !data.orderId || !data.customerLabel || data.total === undefined) {
        setSubmitError(data.error ?? "ส่งออเดอร์ไม่สำเร็จ");
        return;
      }
      setOrderId(data.orderId);
      setResult({
        customerLabel: data.customerLabel,
        total: data.total,
        paymentIntent,
        promptPayPayload: data.promptPayPayload ?? null,
      });
      setStep("done");
    } catch {
      setSubmitError("เชื่อมต่อไม่ได้ กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNotifyTransfer() {
    if (!orderId) return;
    setNotifying(true);
    try {
      await fetch(`/api/customer/pickup/order/${orderId}/notify-transfer`, { method: "POST" });
      setTransferNotified(true);
    } catch {
      // Best-effort nudge to staff — if this fails the customer can still just wait, staff
      // review payments manually regardless, so there's nothing more useful to show here.
    } finally {
      setNotifying(false);
    }
  }

  if (status === "loading") {
    return <main className="flex min-h-dvh items-center justify-center text-muted-foreground">กำลังโหลดเมนู...</main>;
  }
  if (status === "error" || !menu) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-lg font-medium">เชื่อมต่อไม่ได้</p>
        <p className="text-sm text-muted-foreground">กรุณาลองใหม่อีกครั้ง</p>
      </main>
    );
  }

  if (step === "done" && result) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-xl font-semibold">สั่งอาหารสำเร็จ 🙏</p>
        <p className="text-lg">
          หมายเลขอ้างอิงของคุณคือ <span className="font-semibold">{result.customerLabel}</span>
        </p>
        {/* What was actually ordered — the customer had no other confirmation of this before,
            just the total. `cart` is never cleared after a successful submit (unlike
            CustomerOrderScreen's dine-in flow, which folds it into a live "สั่งไปแล้ว" list
            instead), so it's still exactly what was sent. */}
        <div className="w-full max-w-xs rounded-lg border border-border p-3 text-left text-sm">
          {cart.map((line) => (
            <div key={line.key} className="mb-2 border-b border-border pb-2 last:mb-0 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {line.quantity}x {line.productName}
                </span>
                <span className="tabular-nums text-muted-foreground">{formatCurrency(line.lineTotal, currency)}</span>
              </div>
              {line.modifiers.map((m) => (
                <p key={m.optionId} className="text-xs text-muted-foreground">
                  {m.optionName}
                  {m.priceDelta !== 0 ? ` (+${formatCurrency(m.priceDelta, currency)})` : ""}
                </p>
              ))}
              {line.note ? <p className="text-xs text-muted-foreground">หมายเหตุ: {line.note}</p> : null}
            </div>
          ))}
        </div>

        <p className="text-muted-foreground">ยอดที่ต้องชำระ {formatCurrency(result.total, currency)}</p>

        {result.paymentIntent === "cash" ? (
          <p className="max-w-xs text-sm text-muted-foreground">กรุณาชำระเงินสดที่เคาน์เตอร์เมื่อมารับอาหาร</p>
        ) : (
          <div className="flex flex-col items-center gap-3">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- locally-generated data: URL, not a remote image
              <img src={qrDataUrl} alt="QR พร้อมเพย์" className="h-56 w-56 rounded-lg border border-border" />
            ) : (
              <div className="flex h-56 w-56 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
                กำลังสร้าง QR...
              </div>
            )}
            <p className="max-w-xs text-sm text-muted-foreground">สแกนจ่ายด้วยแอปธนาคารของคุณ ยอดจะขึ้นให้อัตโนมัติ</p>
            {transferNotified ? (
              <p className="text-sm text-success">แจ้งแล้ว — พนักงานจะตรวจสอบยอดโอนให้เร็วที่สุด</p>
            ) : (
              <Button onClick={handleNotifyTransfer} disabled={notifying}>
                แจ้งว่าโอนแล้ว
              </Button>
            )}
          </div>
        )}

        <p className="mt-2 text-xs text-muted-foreground">ปิดหน้านี้ได้เลย</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col pb-40">
      <header className="border-b border-border bg-card p-4">
        <p className="text-xl font-semibold">สั่งกลับบ้าน</p>
      </header>

      <div className="flex gap-2 overflow-x-auto border-b border-border bg-card p-3">
        {activeCategories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCategoryId(c.id)}
            className={
              "shrink-0 rounded-lg px-4 py-2 text-sm font-medium " +
              (c.id === currentCategoryId ? "bg-primary text-primary-foreground" : "border border-border bg-card")
            }
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 p-3 sm:grid-cols-3">
        {visibleProducts.map((product) => (
          <button
            key={product.id}
            disabled={!product.active}
            onClick={() => handleProductTap(product)}
            className={
              "flex flex-col items-start gap-1 rounded-lg border p-3 text-left " +
              (product.active
                ? "border-border bg-card hover:bg-accent"
                : "cursor-not-allowed border-border bg-muted/40 opacity-60")
            }
          >
            {product.imageUrl ? (
              // Admin-pasted URL from any host (see Product.imageUrl's doc comment); next/image
              // would need every host allow-listed ahead of time.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.imageUrl}
                alt={product.name}
                className={"h-20 w-full rounded-md object-cover" + (product.active ? "" : " opacity-60 grayscale")}
              />
            ) : null}
            <span className={"font-medium" + (product.active ? "" : " line-through")}>{product.name}</span>
            {product.active ? (
              <span className="text-sm text-muted-foreground">{formatCurrency(product.price, currency)}</span>
            ) : (
              <span className="text-sm font-medium text-destructive">ของหมด</span>
            )}
          </button>
        ))}
        {visibleProducts.length === 0 ? (
          <p className="col-span-full text-sm text-muted-foreground">ยังไม่มีเมนูในหมวดนี้</p>
        ) : null}
      </div>

      {pickerProduct ? (
        <ModifierPickerDialog
          key={pickerProduct.id}
          product={pickerProduct}
          open={Boolean(pickerProduct)}
          onOpenChange={(open) => !open && setPickerProduct(null)}
          modifierGroups={menu.modifierGroups}
          modifierOptions={menu.modifierOptions}
          currency={currency}
          onConfirm={({ quantity, modifiers, note }) => addToCart(pickerProduct, quantity, modifiers, note)}
        />
      ) : null}

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card p-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
        {cart.length > 0 && (
          <ul className="mb-2 flex max-h-32 flex-col gap-1 overflow-y-auto text-sm">
            {cart.map((line) => (
              <li key={line.key} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {line.productName} x{line.quantity}
                  {line.note ? <span className="text-muted-foreground"> ({line.note})</span> : null}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums text-muted-foreground">{formatCurrency(line.lineTotal, currency)}</span>
                  <button onClick={() => removeFromCart(line.key)} className="text-destructive" aria-label="ลบ">
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button className="w-full" size="lg" disabled={cart.length === 0} onClick={() => setStep("checkout")}>
          {cart.length > 0 ? `สั่งอาหาร (${formatCurrency(cartTotal, currency)})` : "เลือกเมนู"}
        </Button>
      </div>

      <Dialog open={step === "checkout"} onOpenChange={(open) => !open && setStep("cart")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ยืนยันสั่งอาหาร</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            {needsName ? (
              <div className="grid gap-2">
                <label htmlFor="pickup-name" className="text-sm font-medium">
                  ชื่อของคุณ (สำหรับเรียกรับอาหาร)
                </label>
                <Input
                  id="pickup-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="เช่น คุณเอ"
                  autoFocus
                />
              </div>
            ) : null}

            <div className="grid gap-2">
              <p className="text-sm font-medium">ชำระเงินโดย</p>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentIntent("cash")}
                  className={
                    "rounded-lg border px-4 py-3 text-left " +
                    (paymentIntent === "cash" ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-accent")
                  }
                >
                  เงินสด (ชำระที่เคาน์เตอร์)
                </button>
                {menu.promptPayAvailable ? (
                  <button
                    type="button"
                    onClick={() => setPaymentIntent("transfer")}
                    className={
                      "rounded-lg border px-4 py-3 text-left " +
                      (paymentIntent === "transfer"
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:bg-accent")
                    }
                  >
                    โอนพร้อมเพย์ (สแกน QR จ่ายเอง)
                  </button>
                ) : null}
              </div>
            </div>

            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStep("cart")}>
              ย้อนกลับ
            </Button>
            <Button onClick={handleConfirmOrder} disabled={!canConfirm || submitting}>
              ยืนยันสั่งอาหาร
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
