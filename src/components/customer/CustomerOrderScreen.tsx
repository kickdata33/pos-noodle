"use client";

import { useEffect, useMemo, useState } from "react";

import { ModifierPickerDialog } from "@/components/pos/ModifierPickerDialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { computeLineTotal, groupItemsByProduct } from "@/lib/pos/pricing";
import type { Category, ModifierGroup, ModifierOption, OrderItem, OrderItemModifier, Product } from "@/types";

interface MenuResponse {
  categories: Category[];
  products: Product[];
  modifierGroups: ModifierGroup[];
  modifierOptions: ModifierOption[];
  currency: string;
}

interface TableResponse {
  table: { id: string; name: string };
  existingItems: OrderItem[];
  orderNumber: string | null;
}

/** A locally-built cart line before it's ever sent to the server — no `id` yet (the API assigns
 * a real one once the submission is accepted), so this is a distinct shape from `OrderItem`. */
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

type Status = "loading" | "ready" | "not-found" | "error";

/**
 * The QR self-order screen (`/order/table/[tableId]`) — no login, reachable by anyone who scans
 * the table's code. Deliberately kept separate from staff `OrderScreen` rather than reused: it
 * never touches Firestore directly (everything goes through the `/api/customer/*` routes, see
 * their file comments for why), has no checkout/removal/audit-log affordances, and submits a
 * whole cart at once instead of auto-saving per tap.
 */
export function CustomerOrderScreen({ tableId }: { tableId: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [tableInfo, setTableInfo] = useState<TableResponse | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [menuRes, tableRes] = await Promise.all([
          fetch("/api/customer/menu"),
          fetch(`/api/customer/table/${tableId}`),
        ]);
        if (cancelled) return;
        if (!tableRes.ok) {
          setStatus("not-found");
          return;
        }
        setMenu((await menuRes.json()) as MenuResponse);
        setTableInfo((await tableRes.json()) as TableResponse);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tableId]);

  const activeCategories = useMemo(() => menu?.categories ?? [], [menu]);
  const currentCategoryId = activeCategoryId ?? activeCategories[0]?.id ?? null;
  const visibleProducts = useMemo(
    () => (menu?.products ?? []).filter((p) => p.categoryId === currentCategoryId),
    [menu, currentCategoryId]
  );

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
  const currency = menu?.currency ?? "THB";

  async function handleSubmit() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/customer/table/${tableId}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            optionIds: line.modifiers.map((m) => m.optionId),
            note: line.note,
          })),
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSubmitError(data.error ?? "ส่งออเดอร์ไม่สำเร็จ");
        return;
      }
      // Fold the just-submitted cart into "สั่งไปแล้ว" so a second round on the same visit still
      // shows everything ordered so far, without waiting on a re-fetch.
      setTableInfo((prev) =>
        prev
          ? {
              ...prev,
              existingItems: [
                ...prev.existingItems,
                ...cart.map((line) => ({
                  id: line.key,
                  productId: line.productId,
                  productName: line.productName,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  modifiers: line.modifiers,
                  note: line.note,
                  lineTotal: line.lineTotal,
                })),
              ],
            }
          : prev
      );
      setCart([]);
      setJustSubmitted(true);
      setTimeout(() => setJustSubmitted(false), 3000);
    } catch {
      setSubmitError("เชื่อมต่อไม่ได้ กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return <main className="flex min-h-dvh items-center justify-center text-muted-foreground">กำลังโหลดเมนู...</main>;
  }
  if (status === "not-found") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-lg font-medium">ไม่พบโต๊ะนี้</p>
        <p className="text-sm text-muted-foreground">กรุณาสแกน QR โค้ดที่โต๊ะอีกครั้ง หรือแจ้งพนักงาน</p>
      </main>
    );
  }
  if (status === "error" || !menu || !tableInfo) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-lg font-medium">เชื่อมต่อไม่ได้</p>
        <p className="text-sm text-muted-foreground">กรุณาลองใหม่อีกครั้ง</p>
      </main>
    );
  }

  const orderedGroups = groupItemsByProduct(tableInfo.existingItems);

  return (
    <div className="flex min-h-dvh flex-col pb-40">
      <header className="border-b border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">โต๊ะ</p>
        <p className="text-xl font-semibold">{tableInfo.table.name}</p>
      </header>

      {orderedGroups.length > 0 && (
        <section className="border-b border-border bg-muted/40 p-4">
          <p className="mb-2 text-sm font-medium text-muted-foreground">สั่งไปแล้ว</p>
          <ul className="flex flex-col gap-1 text-sm">
            {orderedGroups.map((g) => (
              <li key={g.productId} className="flex justify-between">
                <span>
                  {g.productName} x{g.totalQty}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
            onClick={() => handleProductTap(product)}
            className="flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-3 text-left hover:bg-accent"
          >
            <span className="font-medium">{product.name}</span>
            <span className="text-sm text-muted-foreground">{formatCurrency(product.price, currency)}</span>
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

      {/* Cart + submit bar, fixed to the bottom so it's reachable one-handed on a phone. */}
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
        {submitError ? <p className="mb-2 text-sm text-destructive">{submitError}</p> : null}
        {justSubmitted ? <p className="mb-2 text-sm text-success">ส่งออเดอร์แล้ว! แจ้งพนักงานเรียบร้อย</p> : null}
        <Button
          className="w-full"
          size="lg"
          disabled={cart.length === 0 || submitting}
          onClick={handleSubmit}
        >
          {submitting
            ? "กำลังส่ง..."
            : cart.length === 0
              ? "แตะเมนูเพื่อสั่งอาหาร"
              : `สั่งอาหาร (${cart.length} รายการ · ${formatCurrency(cartTotal, currency)})`}
        </Button>
      </div>
    </div>
  );
}
