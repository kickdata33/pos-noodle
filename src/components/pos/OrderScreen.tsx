"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { CheckoutDialog } from "@/components/pos/CheckoutDialog";
import { ItemNoteDialog } from "@/components/pos/ItemNoteDialog";
import { ModifierPickerDialog } from "@/components/pos/ModifierPickerDialog";
import { RemoveItemDialog } from "@/components/pos/RemoveItemDialog";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { useAuth } from "@/hooks/useAuth";
import { computeLineTotal, computeOrderTotals } from "@/lib/pos/pricing";
import { generateOrderNumber } from "@/lib/pos/orderNumber";
import { auditLogRepository } from "@/repositories/auditLogRepository";
import { categoryRepository } from "@/repositories/categoryRepository";
import { channelRepository } from "@/repositories/channelRepository";
import { modifierGroupRepository, modifierOptionRepository } from "@/repositories/modifierRepository";
import { orderRepository } from "@/repositories/orderRepository";
import { paymentMethodRepository } from "@/repositories/paymentMethodRepository";
import { paymentRepository } from "@/repositories/paymentRepository";
import { productRepository } from "@/repositories/productRepository";
import { shopRepository } from "@/repositories/shopRepository";
import { tableRepository } from "@/repositories/tableRepository";
import type {
  AuditReason,
  Category,
  ModifierGroup,
  ModifierOption,
  Order,
  OrderItem,
  PaymentMethod,
  Product,
  SalesChannel,
  ShopSettings,
  Table,
} from "@/types";

type DraftOrder = Omit<Order, "id"> & { id: string | null };

interface Props {
  orderId: string | null;
  initialTableId: string | null;
  initialChannelId: string | null;
}

const DEFAULT_SETTINGS: Pick<
  ShopSettings,
  "vatEnabled" | "vatRate" | "serviceChargeEnabled" | "serviceChargeRate" | "currency"
> = { vatEnabled: false, vatRate: 0, serviceChargeEnabled: false, serviceChargeRate: 0, currency: "THB" };

export function OrderScreen({ orderId, initialTableId, initialChannelId }: Props) {
  const router = useRouter();
  const { appUser } = useAuth();

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [modifierOptions, setModifierOptions] = useState<ModifierOption[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const [order, setOrder] = useState<DraftOrder | null>(null);
  // Mirrors `order` for the mutation functions below (applyItems, ensureSaved, etc). Those are
  // recreated every render and can be bound to a *stale* render if two of them fire close
  // together (e.g. the qty stepper tapped right after "บันทึกออเดอร์"'s async save resolves) —
  // reading `order.id` from that stale closure instead of the actual latest state can silently
  // overwrite a just-persisted order's id back to null. Reading from this ref instead of the
  // closed-over `order` variable inside those functions keeps them correct regardless of when
  // they were bound. JSX below still reads `order` (state) directly, which is always current.
  const orderRef = useRef<DraftOrder | null>(null);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);
  // Latches true while `ensureSaved` has an in-flight order creation — see that function's
  // comment for why this is a plain boolean rather than the pending Promise itself.
  const creatingRef = useRef(false);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OrderItem | null>(null);
  const [noteTarget, setNoteTarget] = useState<OrderItem | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Brief "บันทึกแล้ว" flash after every successful auto-save (item request: no manual save step,
  // but staff should still see confirmation that a change actually reached the server). No
  // ref-tracked timer handle to clear/replace on rapid repeats — deliberately simple, since
  // this codebase's purity linter flags a Promise *or* a setTimeout handle stored on a ref as
  // unsafe and then (surprisingly) stops trusting unrelated `Date.now()` calls elsewhere in the
  // file too. A slightly-too-long flash on a fast double-save is a fine trade for that.
  const [justSaved, setJustSaved] = useState(false);
  function flashSaved() {
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1500);
  }

  useEffect(() => categoryRepository.subscribeForShop(DEFAULT_SHOP_ID, setCategories), []);
  useEffect(() => productRepository.subscribeForShop(DEFAULT_SHOP_ID, setProducts), []);
  useEffect(() => modifierGroupRepository.subscribeForShop(DEFAULT_SHOP_ID, setModifierGroups), []);
  useEffect(() => modifierOptionRepository.subscribeForShop(DEFAULT_SHOP_ID, setModifierOptions), []);
  useEffect(() => channelRepository.subscribeForShop(DEFAULT_SHOP_ID, setChannels), []);
  useEffect(() => tableRepository.subscribeForShop(DEFAULT_SHOP_ID, setTables), []);
  useEffect(() => paymentMethodRepository.subscribeForShop(DEFAULT_SHOP_ID, setPaymentMethods), []);
  useEffect(() => {
    shopRepository.getSettings(DEFAULT_SHOP_ID).then((s) => {
      if (s) setSettings(s);
    });
  }, []);

  // Load an existing order, or seed a fresh local draft — runs once catalog data + auth are ready.
  useEffect(() => {
    if (order || !appUser) return;

    if (orderId) {
      orderRepository.getById(orderId).then((existing) => {
        if (existing) setOrder(existing);
      });
      return;
    }

    if (channels.length === 0) return; // wait for channel list before seeding a draft
    if (initialTableId && tables.length === 0) return;

    const table = initialTableId ? tables.find((t) => t.id === initialTableId) ?? null : null;
    const channel = initialTableId
      ? channels.find((c) => c.requiresTable && c.active) ?? null
      : channels.find((c) => c.id === initialChannelId) ?? null;
    if (!channel) return;

    const now = Date.now();
    // This effect seeds *local* draft state (never persisted until the first save) once the
    // channel/table catalog data it depends on has loaded — there's no external system to
    // subscribe to here, this genuinely is a one-time derivation from async data, not a case
    // the "move it into an event handler" rewrite applies to.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder({
      id: null,
      orderNumber: "",
      shopId: DEFAULT_SHOP_ID,
      orderType: table ? "dineIn" : "other",
      channelId: channel.id,
      channelName: channel.name,
      tableId: table?.id ?? null,
      tableName: table?.name ?? null,
      status: "OPEN",
      items: [],
      subtotal: 0,
      discount: 0,
      serviceCharge: 0,
      tax: 0,
      total: 0,
      paymentStatus: "UNPAID",
      paymentMethodId: null,
      paymentMethodName: null,
      cashReceived: null,
      changeDue: null,
      createdBy: appUser.id,
      createdByName: appUser.name,
      createdAt: now,
      updatedAt: now,
      paidAt: null,
    });
  }, [orderId, appUser, channels, tables, initialTableId, initialChannelId, order]);

  const totals = useMemo(
    () => (order ? computeOrderTotals(order.items, settings, order.discount) : null),
    [order, settings]
  );

  /**
   * Groups cart lines by product for display only — the underlying `order.items` stay separate
   * `OrderItem`s (own id, own note, own audit trail on removal) no matter when each was added.
   * User request: two "ก๋วยเตี๋ยวหมู" added in separate taps with different notes ("ไม่งอก" vs
   * "ไม่ผัก") should read as "ก๋วยเตี๋ยวหมู x2" rather than two identical-looking lines — but
   * without losing which one is which, so each still shows its own note underneath. A group of
   * one renders exactly as a plain line always has (no redundant "x1" header).
   */
  const groupedItems = useMemo(() => {
    if (!order) return [];
    const groups: { productId: string; productName: string; totalQty: number; items: OrderItem[] }[] = [];
    for (const item of order.items) {
      const group = groups.find((g) => g.productId === item.productId);
      if (group) {
        group.totalQty += item.quantity;
        group.items.push(item);
      } else {
        groups.push({ productId: item.productId, productName: item.productName, totalQty: item.quantity, items: [item] });
      }
    }
    return groups;
  }, [order]);

  const activeCategories = categories.filter((c) => c.active);
  const currentCategoryId = activeCategoryId ?? activeCategories[0]?.id ?? null;
  const visibleProducts = products.filter((p) => p.active && p.categoryId === currentCategoryId);

  /**
   * Applies a new items array: updates local state, and saves — immediately if the order is
   * already persisted (item 13–14: another staff member glancing at the table grid must see the
   * current total), or by auto-creating the order right now if this is the first item on a
   * fresh draft (via `ensureSaved`), so tapping a menu item is the only "save" action staff ever
   * need — a mistaken add is fixed by removing/editing it, not by an explicit save step.
   *
   * Always reads/writes through `orderRef.current`, never the `order` this function's own
   * closure captured — see the ref's comment above for why — and writes it *synchronously*
   * (not via `setOrder`'s functional form, which would only resolve on the next render) so a
   * second mutation fired immediately after (e.g. the qty stepper right after the item that
   * triggered auto-save) sees this one's result rather than a stale pre-save snapshot.
   */
  async function applyItems(newItems: OrderItem[]) {
    const current = orderRef.current;
    if (!current) return;
    const newTotals = computeOrderTotals(newItems, settings, current.discount);
    const updatedAt = Date.now();
    const updatedDraft: DraftOrder = { ...current, items: newItems, ...newTotals, updatedAt };
    orderRef.current = updatedDraft;
    setOrder(updatedDraft);
    if (current.id) {
      await orderRepository.update(current.id, {
        items: newItems,
        subtotal: newTotals.subtotal,
        serviceCharge: newTotals.serviceCharge,
        tax: newTotals.tax,
        total: newTotals.total,
        updatedAt,
      });
      flashSaved();
    } else if (newItems.length > 0) {
      await ensureSaved();
    }
  }

  function handleAddProduct(product: Product) {
    if (product.modifierGroupIds.length > 0) {
      setPickerProduct(product);
      return;
    }
    addItemToCart(product, 1, [], "");
  }

  function addItemToCart(
    product: Product,
    quantity: number,
    modifiers: OrderItem["modifiers"],
    note: string
  ) {
    const current = orderRef.current;
    if (!current) return;
    const lineTotal = computeLineTotal(product.price, modifiers, quantity);
    const item: OrderItem = {
      id: crypto.randomUUID(),
      productId: product.id,
      productName: product.name,
      quantity,
      unitPrice: product.price,
      modifiers,
      note,
      lineTotal,
    };
    applyItems([...current.items, item]);
  }

  function changeQuantity(item: OrderItem, delta: number) {
    const current = orderRef.current;
    if (!current) return;
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      requestRemove(item);
      return;
    }
    const newItems = current.items.map((i) =>
      i.id === item.id
        ? { ...i, quantity: newQty, lineTotal: computeLineTotal(i.unitPrice, i.modifiers, newQty) }
        : i
    );
    applyItems(newItems);
  }

  /**
   * Edits a line's free-text note (e.g. "ไม่งอก", "ไม่ผัก") — the only way to attach one to a
   * product that has no modifier groups configured (see `ItemNoteDialog`), and also lets staff
   * fix a note on an already-added line without removing and re-adding it. Not audit-gated like
   * removal — a note is metadata about what to cook, not a change to the bill.
   */
  function updateItemNote(item: OrderItem, note: string) {
    const current = orderRef.current;
    if (!current) return;
    const newItems = current.items.map((i) => (i.id === item.id ? { ...i, note } : i));
    applyItems(newItems);
  }

  /** Free removal before the first save (item 18); after that, gated behind a reason (item 19). */
  function requestRemove(item: OrderItem) {
    const current = orderRef.current;
    if (!current) return;
    if (!current.id) {
      applyItems(current.items.filter((i) => i.id !== item.id));
      return;
    }
    setRemoveTarget(item);
  }

  async function confirmRemove(reason: AuditReason, note: string) {
    const current = orderRef.current;
    if (!current || !removeTarget || !current.id) return;
    const target = removeTarget;
    await applyItems(current.items.filter((i) => i.id !== target.id));
    await auditLogRepository.create({
      shopId: DEFAULT_SHOP_ID,
      action: "ORDER_ITEM_REMOVED",
      orderId: current.id,
      description: `ลบ "${target.productName}" ออกจากออเดอร์ ${current.orderNumber}`,
      reason,
      reasonNote: reason === "อื่น ๆ" ? note : null,
      performedBy: appUser!.id,
      performedByName: appUser!.name,
      createdAt: Date.now(),
    });
    setRemoveTarget(null);
  }

  /**
   * First save: draft → a real Firestore doc. Returns the order id (existing or newly created).
   * Concurrent callers (e.g. auto-save from the item that just landed and a fast follow-up edit)
   * share the same in-flight creation via `creatingRef` instead of each generating their own
   * order number and doc.
   */
  async function ensureSaved(): Promise<string> {
    const current = orderRef.current;
    if (!current) throw new Error("no order");
    if (current.id) return current.id;

    if (creatingRef.current) {
      // Another caller (e.g. auto-save from the item that just landed) is already creating the
      // order — wait for that to land instead of starting a second `generateOrderNumber` +
      // `create`, which would silently produce two Firestore docs for one table. Polling
      // `orderRef.current` here rather than sharing the in-flight Promise directly sidesteps a
      // real quirk: storing a pending Promise on a ref confuses this codebase's purity linter
      // into flagging unrelated `Date.now()` calls elsewhere in the file as unsafe.
      while (creatingRef.current) {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      if (orderRef.current?.id) return orderRef.current.id;
    }

    creatingRef.current = true;
    try {
      const orderNumber = await generateOrderNumber(DEFAULT_SHOP_ID);
      // Re-read the ref right *now*, not the `current` snapshot from when this call started —
      // a fast follow-up edit (e.g. removing the very item that triggered this save) that
      // landed while `generateOrderNumber` was in flight must be reflected in what's persisted.
      const latest = orderRef.current ?? current;
      // `latest` is a DraftOrder, which really does carry an `id: string | null` field at
      // runtime — the `Omit<Order, "id">` annotation below is compile-time only and does NOT
      // strip it from the spread. Destructuring it off here (the `void` just tells the linter
      // the omission itself is the point, not an oversight) is required, not decorative:
      // without it, `payload` silently includes `id: null`, which `addDoc` happily writes into
      // the new document's *data* — separate from the document's real, auto-generated Firestore
      // id — and every later read merges that stored `id: null` back in, clobbering the real
      // one. That's exactly what shipped and broke the table grid ("/pos/order/null", stuck on
      // "กำลังโหลด...") before this fix.
      const { id: draftId, ...currentWithoutId } = latest;
      void draftId;
      const payload: Omit<Order, "id"> = { ...currentWithoutId, orderNumber, updatedAt: Date.now() };
      const id = await orderRepository.create(payload);
      orderRef.current = { ...payload, id };
      setOrder(orderRef.current);
      router.replace(`/pos/order/${id}`);
      flashSaved();
      return id;
    } finally {
      creatingRef.current = false;
    }
  }

  async function handleConfirmPayment(payment: {
    paymentMethodId: string;
    paymentMethodName: string;
    cashReceived: number | null;
    changeDue: number | null;
  }) {
    if (!order || !totals) return;
    setSaving(true);
    setError(null);
    try {
      const id = await ensureSaved();
      const paidAt = Date.now();
      await orderRepository.update(id, {
        status: "PAID",
        paymentStatus: "PAID",
        paymentMethodId: payment.paymentMethodId,
        paymentMethodName: payment.paymentMethodName,
        cashReceived: payment.cashReceived,
        changeDue: payment.changeDue,
        paidAt,
        updatedAt: paidAt,
      });
      await paymentRepository.create({
        orderId: id,
        shopId: DEFAULT_SHOP_ID,
        paymentMethodId: payment.paymentMethodId,
        paymentMethodName: payment.paymentMethodName,
        amount: totals.total,
        cashReceived: payment.cashReceived,
        changeDue: payment.changeDue,
        createdBy: appUser!.id,
        createdAt: paidAt,
      });
      router.push("/pos");
    } catch {
      setError("ชำระเงินไม่สำเร็จ ลองอีกครั้ง");
      setSaving(false);
    }
  }

  if (!order || !totals) {
    return <main className="p-6 text-muted-foreground">กำลังโหลด...</main>;
  }

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Left: category tabs + product grid (item 24: ~55-60% on tablet landscape) */}
      <div className="flex min-h-0 flex-1 flex-col md:w-[58%]">
        <div className="flex gap-2 overflow-x-auto border-b border-border p-3">
          {activeCategories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategoryId(c.id)}
              className={
                "shrink-0 rounded-lg px-4 py-2 text-sm font-medium " +
                (c.id === currentCategoryId ? "bg-primary text-primary-foreground" : "bg-card border border-border")
              }
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto p-3 sm:grid-cols-3">
          {visibleProducts.map((product) => (
            <button
              key={product.id}
              onClick={() => handleAddProduct(product)}
              className="flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-3 text-left hover:bg-accent"
            >
              <span className="font-medium">{product.name}</span>
              <span className="text-sm text-muted-foreground">
                {formatCurrency(product.price, settings.currency)}
              </span>
            </button>
          ))}
          {visibleProducts.length === 0 ? (
            <p className="col-span-full text-sm text-muted-foreground">ยังไม่มีเมนูในหมวดนี้</p>
          ) : null}
        </div>
      </div>

      {/* Right: current order (item 24: ~40-45%) */}
      <div className="flex min-h-0 flex-col border-t border-border md:w-[42%] md:border-l md:border-t-0">
        <div className="flex items-start justify-between border-b border-border p-3">
          <div>
            <p className="font-medium">
              {order.tableName ? `โต๊ะ ${order.tableName}` : order.channelName}
            </p>
            {order.orderNumber ? (
              <p className="text-xs text-muted-foreground">{order.orderNumber}</p>
            ) : null}
          </div>
          {/* Every menu tap saves immediately (create on the first item, update after) — this is
              the only save confirmation staff get, since there's no manual "บันทึก" step anymore. */}
          {justSaved ? (
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              บันทึกแล้ว
            </span>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {groupedItems.map((group) => (
            <div key={group.productId} className="mb-3 border-b border-border pb-3 last:border-0">
              {group.items.length > 1 ? (
                <p className="mb-2 text-sm font-semibold">
                  {group.productName} x{group.totalQty}
                </p>
              ) : null}
              <div className="grid gap-3">
                {group.items.map((item) => (
                  <div key={item.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {/* Grouped (2+ lines of the same product): the header above already shows
                            the name, so each sub-line only needs to show what makes it different —
                            its own note/modifiers — otherwise the product name repeats as usual. */}
                        {group.items.length === 1 ? <p className="font-medium">{item.productName}</p> : null}
                        {item.modifiers.map((m) => (
                          <p key={m.optionId} className="text-xs text-muted-foreground">
                            {m.optionName}
                            {m.priceDelta !== 0 ? ` (+${formatCurrency(m.priceDelta, settings.currency)})` : ""}
                          </p>
                        ))}
                        {item.note ? (
                          <p className="text-xs text-muted-foreground">หมายเหตุ: {item.note}</p>
                        ) : group.items.length > 1 ? (
                          <p className="text-xs text-muted-foreground">ไม่มีหมายเหตุ</p>
                        ) : null}
                      </div>
                      <span className="whitespace-nowrap font-medium">
                        {formatCurrency(item.lineTotal, settings.currency)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Button variant="outline" size="icon" onClick={() => changeQuantity(item, -1)}>
                        −
                      </Button>
                      <span className="w-6 text-center">{item.quantity}</span>
                      <Button variant="outline" size="icon" onClick={() => changeQuantity(item, 1)}>
                        +
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setNoteTarget(item)}>
                        หมายเหตุ
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => requestRemove(item)} className="ml-auto text-destructive">
                        ลบ
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {order.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีรายการ — แตะเมนูด้านซ้ายเพื่อเพิ่ม</p>
          ) : null}
        </div>

        <div className="border-t border-border p-3">
          <div className="mb-3 grid gap-1 text-sm">
            <div className="flex justify-between">
              <span>ยอดรวม</span>
              <span>{formatCurrency(totals.subtotal, settings.currency)}</span>
            </div>
            {totals.serviceCharge > 0 ? (
              <div className="flex justify-between text-muted-foreground">
                <span>ค่าบริการ</span>
                <span>{formatCurrency(totals.serviceCharge, settings.currency)}</span>
              </div>
            ) : null}
            {totals.tax > 0 ? (
              <div className="flex justify-between text-muted-foreground">
                <span>ภาษีมูลค่าเพิ่ม</span>
                <span>{formatCurrency(totals.tax, settings.currency)}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-base font-semibold">
              <span>ยอดสุทธิ</span>
              <span>{formatCurrency(totals.total, settings.currency)}</span>
            </div>
          </div>
          {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            {/* No manual "บันทึกออเดอร์" step — every menu tap saves itself (see `applyItems`).
                This button is just navigation, available whether or not anything's been added yet. */}
            <Button variant="outline" onClick={() => router.push("/pos")}>
              กลับหน้าแรก
            </Button>
            <Button onClick={() => setCheckoutOpen(true)} disabled={saving || order.items.length === 0}>
              คิดเงิน
            </Button>
          </div>
        </div>
      </div>

      {pickerProduct ? (
        <ModifierPickerDialog
          key={pickerProduct.id}
          product={pickerProduct}
          open={Boolean(pickerProduct)}
          onOpenChange={(open) => !open && setPickerProduct(null)}
          modifierGroups={modifierGroups}
          modifierOptions={modifierOptions}
          currency={settings.currency}
          onConfirm={({ quantity, modifiers, note }) =>
            addItemToCart(pickerProduct, quantity, modifiers, note)
          }
        />
      ) : null}

      {removeTarget ? (
        <RemoveItemDialog
          open={Boolean(removeTarget)}
          onOpenChange={(open) => !open && setRemoveTarget(null)}
          itemName={removeTarget.productName}
          onConfirm={confirmRemove}
        />
      ) : null}

      {noteTarget ? (
        <ItemNoteDialog
          key={noteTarget.id}
          open={Boolean(noteTarget)}
          onOpenChange={(open) => !open && setNoteTarget(null)}
          itemName={noteTarget.productName}
          initialNote={noteTarget.note}
          onConfirm={(note) => updateItemNote(noteTarget, note)}
        />
      ) : null}

      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        totals={totals}
        currency={settings.currency}
        paymentMethods={paymentMethods.filter((m) => m.active)}
        saving={saving}
        onConfirm={handleConfirmPayment}
      />
    </div>
  );
}
