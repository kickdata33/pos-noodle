"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { CancelOrderDialog } from "@/components/pos/CancelOrderDialog";
import { CheckoutDialog } from "@/components/pos/CheckoutDialog";
import { ItemNoteDialog } from "@/components/pos/ItemNoteDialog";
import { ModifierPickerDialog } from "@/components/pos/ModifierPickerDialog";
import { MoveTableDialog } from "@/components/pos/MoveTableDialog";
import { usePosCatalog } from "@/components/pos/PosCatalogContext";
import { RemoveItemDialog } from "@/components/pos/RemoveItemDialog";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatTime } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { printReceiptViaEpos } from "@/lib/pos/eposPrint";
import {
  activeDealsAt,
  computeLineTotal,
  dealWindowLabel,
  computeOrderTotals,
  groupItemsByProduct,
  resolveChannelPrice,
  resolveModifiersFromSelections,
} from "@/lib/pos/pricing";
import { resolveItemName } from "@/lib/pos/itemName";
import { increaseItemQuantity } from "@/lib/pos/kitchenAlerts";
import { generateOrderNumber } from "@/lib/pos/orderNumber";
import { createOrJoinTableOrder } from "@/lib/pos/tableOrder";
import { printQrForTable } from "@/lib/pos/tableQrPrint";
import { printCheckBill, sendKitchenCancellation, sendOrderToKitchen } from "@/lib/pos/printQueue";
import { countUnsentToKitchen } from "@/lib/pos/printTickets";
import { deductStockForPaidOrder } from "@/lib/pos/stockService";
import { buildOrderReceipt } from "@/lib/pos/receipt";
import { auditLogRepository } from "@/repositories/auditLogRepository";
import { orderRepository } from "@/repositories/orderRepository";
import { paymentRepository } from "@/repositories/paymentRepository";
import type { AuditReason, Order, OrderItem, Product, ShopSettings, Table } from "@/types";

type DraftOrder = Omit<Order, "id"> & { id: string | null };

/**
 * Tells the shop's Telegram bot (if configured) that a bill was paid or cancelled — see
 * `/api/notify/order-event`'s comment for why this has to be a server route instead of a direct
 * Firestore write. Fire-and-forget, same reasoning as the auto-print call just below each of
 * this function's call sites: an unreachable notification is never worth blocking on.
 */
function notifyOrderEvent(
  event: "paid" | "cancelled",
  order: { orderNumber: string; total?: number; channelName: string; tableName: string | null; paymentMethodName?: string | null }
) {
  void fetch("/api/notify/order-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event,
      orderNumber: order.orderNumber,
      total: order.total,
      channelName: order.channelName,
      tableName: order.tableName,
      paymentMethodName: order.paymentMethodName,
    }),
  }).catch(() => {
    // Best-effort — see the function comment above.
  });
}

/**
 * Invalidates the table's one-time QR token the moment its bill closes — see
 * `/api/pos/tables/[id]/close-session`'s own comment for why this exists (closing the
 * "photographed QR still works after the table turned over" gap) and why it's safe to call
 * unconditionally for every dine-in checkout/cancel (a no-op for a `qrMode: "static"` table).
 * Fire-and-forget, same reasoning as `notifyOrderEvent` right above — never worth blocking
 * checkout/cancel over.
 */
function closeTableSession(tableId: string) {
  void fetch(`/api/pos/tables/${tableId}/close-session`, { method: "POST" }).catch(() => {
    // Best-effort — see the function comment above.
  });
}

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

  // Shared across every /pos/* screen (see `PosCatalogProvider`'s comment) — this screen used to
  // subscribe to all of it itself, meaning every tap into an order re-fetched all seven of these
  // from scratch. `settings` falls back to `DEFAULT_SETTINGS` until the provider's one-time fetch
  // resolves, same as this screen's own local state used to before the fallback existed here.
  const {
    shopId,
    categories,
    products,
    modifierGroups,
    modifierOptions,
    channels,
    tables,
    paymentMethods,
    settings: catalogSettings,
  } = usePosCatalog();
  const settings = catalogSettings ?? DEFAULT_SETTINGS;

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
  // Set once this screen has handed its table over to another device's order and is waiting for
  // the route change — stops the draft-seeding effect from re-creating a draft in the meantime.
  const switchingOrderRef = useRef(false);
  // "This table was already opened on another device" — shown after this screen was switched
  // onto that device's order instead of creating a second one.
  const [joinedNotice, setJoinedNotice] = useState(false);
  // Shop clock for which promotion buttons are live (`activeDealsAt`) — refreshed every 30s so a
  // "ก่อน 20:00" button disappears and its "ตั้งแต่ 20:00" one appears without a reload. Starts
  // at 0 (no deals shown) until the first tick right after mount.
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  // One-tap "พิมพ์ QR ให้ลูกค้าสั่ง" state — see `handlePrintTableQr`.
  const [printingQr, setPrintingQr] = useState(false);
  const [qrPrintMessage, setQrPrintMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Latches true while `sendToKitchen` is writing a ticket — same plain-boolean pattern.
  const sendingToKitchenRef = useRef(false);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
  const [removeTarget, setRemoveTarget] = useState<OrderItem | null>(null);
  const [noteTarget, setNoteTarget] = useState<OrderItem | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [moveTableOpen, setMoveTableOpen] = useState(false);
  // Same shop-wide open-orders list `PosHome`'s table grid uses to derive occupied/empty — needed
  // here only to compute which tables are safe move-targets (see `emptyTables` below), not for
  // anything else on this screen.
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  useEffect(() => orderRepository.subscribeOpenForShop(shopId, setOpenOrders), [shopId]);

  // An empty draft for a table that meanwhile got an order on another device (or from a
  // customer's QR) switches to that order straight away, so the two devices are looking at the
  // same bill before anyone adds anything. Skipped mid-creation — `ensureSaved`'s transaction
  // settles that case itself.
  useEffect(() => {
    if (!order || order.id || !order.tableId || creatingRef.current) return;
    const taken = openOrders.find((o) => o.tableId === order.tableId);
    if (!taken) return;
    switchingOrderRef.current = true;
    orderRef.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the live open-orders feed
    setOrder(null);
    setJoinedNotice(true);
    router.replace(`/pos/order/${taken.id}`);
  }, [order, openOrders, router]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Printing problems are shown, never thrown — the sale and the order must keep working even
  // when the queue write fails (offline, rules not deployed yet).
  const [printError, setPrintError] = useState<string | null>(null);
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

  // Reopening an existing order: subscribe live rather than a one-time fetch. Every edit staff
  // makes here goes straight to Firestore (see `applyItems`), so this screen is only ever
  // showing "the current server state" — but a customer's QR self-order (`/api/customer/table/
  // [tableId]/order`) can add items to the *same* order document from outside this screen at any
  // moment. A one-time `getById` would leave `orderRef.current.items` stale, and the next staff
  // edit's `applyItems` writes `items: newItems` computed from that stale array — silently
  // erasing whatever the customer just ordered. Subscribing keeps the local copy always current.
  useEffect(() => {
    if (!orderId) return;
    switchingOrderRef.current = false;
    return orderRepository.subscribeById(orderId, (existing) => {
      if (existing) setOrder(existing);
    });
  }, [orderId]);

  // Acknowledge a QR self-order once staff actually opens this screen — clears the badge/alert
  // on the POS home table grid. Fires at most once per mount (not on every snapshot the
  // subscription above delivers) via the ref guard. Before clearing, snapshot which item ids were
  // `newSinceReview` into local state: Firestore's copy of that flag gets cleared in the same
  // write, so if the highlight instead read the live field it would flash and vanish on the very
  // render that shows it. `highlightedItemIds` keeps the highlight visible for the rest of this
  // screen's lifetime even though the underlying flag is already gone server-side.
  const acknowledgedRef = useRef(false);
  const [highlightedItemIds, setHighlightedItemIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!order?.id || !order.pendingReview || acknowledgedRef.current) return;
    acknowledgedRef.current = true;
    setHighlightedItemIds(new Set(order.items.filter((i) => i.newSinceReview).map((i) => i.id)));
    orderRepository.update(order.id, {
      pendingReview: false,
      items: order.items.map((i) => (i.newSinceReview ? { ...i, newSinceReview: false } : i)),
    });
  }, [order]);

  // Seed a fresh local draft for a brand-new order — runs once catalog data + auth are ready.
  // Never touches Firestore until the first item is added (`ensureSaved`), so this stays a
  // plain local derivation, unlike the live subscription above for a *reopened* order.
  useEffect(() => {
    if (order || !appUser || orderId || switchingOrderRef.current) return;

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
      shopId,
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
  }, [orderId, appUser, shopId, channels, tables, initialTableId, initialChannelId, order]);

  const totals = useMemo(
    () => (order ? computeOrderTotals(order.items, settings) : null),
    [order, settings]
  );

  // Groups cart lines by product for display only (see `groupItemsByProduct`'s comment) — the
  // underlying `order.items` stay separate `OrderItem`s (own id, own note, own audit trail on
  // removal) no matter when each was added. Shared with `CheckoutDialog`'s summary so what
  // staff see while ordering matches exactly what they confirm at the register.
  const groupedItems = useMemo(() => (order ? groupItemsByProduct(order.items) : []), [order]);

  const activeCategories = categories.filter((c) => c.active);
  const currentCategoryId = activeCategoryId ?? activeCategories[0]?.id ?? null;
  // Sold-out products (`active: false`, toggled from `/pos/stock`) still show here, greyed out
  // with a "ของหมด" badge, rather than vanishing from the grid — a menu item that just disappears
  // reads as "removed from the menu", not "sold out today", and staff need to see it same as
  // customers do (see `handleAddProduct`'s guard and `CustomerOrderScreen`'s matching comment).
  const visibleProducts = products.filter((p) => p.categoryId === currentCategoryId);

  // This order's channel (Grab/LINE MAN/ShopeeFood may mark prices up — item 23) — looked up by
  // id rather than trusted from anywhere else, same as every other channel-derived display value
  // in this app (item 34: never hardcode what should come from data).
  const currentChannel = channels.find((c) => c.id === order?.channelId) ?? null;

  // Move-table targets: active tables with no *other* open order on them right now. Excludes
  // this order's own table too (nothing to move onto) — `openOrders` still includes this order
  // itself while it's open, so the `!== order?.id` guard is required, not defensive filler.
  const occupiedTableIds = new Set(
    openOrders.filter((o) => o.tableId && o.id !== order?.id).map((o) => o.tableId as string)
  );
  const emptyTables = tables.filter(
    (t) => t.active && t.id !== order?.tableId && !occupiedTableIds.has(t.id)
  );

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
    const newTotals = computeOrderTotals(newItems, settings);
    const updatedAt = Date.now();
    const updatedDraft: DraftOrder = { ...current, items: newItems, ...newTotals, updatedAt };
    orderRef.current = updatedDraft;
    setOrder(updatedDraft);
    try {
      await persistItems(current, newItems, newTotals, updatedAt);
      setError(null);
    } catch (err) {
      // Never leave items on screen that never reached the server — that's exactly how one
      // device "has" a table the others can't see. Put the cart back and say so.
      console.error("saving order items failed", err);
      if (orderRef.current === updatedDraft) {
        orderRef.current = current;
        setOrder(current);
      }
      setError("บันทึกไม่สำเร็จ รายการล่าสุดยังไม่ถูกบันทึก ตรวจอินเทอร์เน็ตแล้วกดใหม่");
    }
  }

  async function persistItems(
    current: DraftOrder,
    newItems: OrderItem[],
    newTotals: ReturnType<typeof computeOrderTotals>,
    updatedAt: number
  ) {
    if (current.id) {
      await orderRepository.update(current.id, {
        items: newItems,
        subtotal: newTotals.subtotal,
        // Quantity-deal promotions change these too — without them the saved order would show a
        // total that doesn't match subtotal minus a (missing) discount on bills and receipts.
        discount: newTotals.discount,
        promoDiscount: newTotals.promoDiscount,
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

  /**
   * Adds one promotion set (item: "ให้กดเลือกเป็นโปรโมชั่น ก่อน 2 ทุ่ม หลัง 2 ทุ่ม") — a single
   * line priced at the deal price for the whole set, so staff can't end up at 4 bottles thinking
   * it's 3, and the bill says exactly which promotion was sold. `+`/`-` on the line then add or
   * remove whole sets.
   */
  function addDealToCart(product: Product, deal: { qty: number; price: number }) {
    const current = orderRef.current;
    if (!current || !product.active) return;
    const item: OrderItem = {
      id: crypto.randomUUID(),
      productId: product.id,
      productName: `${product.name} (โปร ${deal.qty} ชิ้น)`,
      quantity: 1,
      unitPrice: deal.price,
      modifiers: [],
      note: "",
      lineTotal: deal.price,
      addedAt: clock || current.updatedAt,
      bundleUnits: deal.qty,
    };
    applyItems([...current.items, item]);
  }

  function handleAddProduct(product: Product) {
    if (!product.active) return; // sold out — see `visibleProducts`'s comment
    if (product.modifierGroupIds.length > 0) {
      setPickerProduct(product);
      return;
    }
    addItemToCart(product, 1, [], "");
  }

  /**
   * Staff-only one-tap shortcut (item request: "อยากให้คลิ๊กง่ายที่สุด") — adds the item straight
   * to the cart with `preset.selections` already resolved into modifiers, skipping
   * `ModifierPickerDialog` entirely. Customer-facing self-order screens never call this; they
   * don't read `posQuickPresets` at all, so they keep showing the full picker unchanged.
   */
  function handleAddPreset(product: Product, preset: NonNullable<Product["posQuickPresets"]>[number]) {
    if (!product.active) return;
    const groups = product.modifierGroupIds
      .map((id) => modifierGroups.find((g) => g.id === id))
      .filter((g): g is (typeof modifierGroups)[number] => Boolean(g && g.active));
    const modifiers = resolveModifiersFromSelections(groups, preset.selections, modifierOptions, product.id);
    addItemToCart(product, 1, modifiers, "");
  }

  function addItemToCart(
    product: Product,
    quantity: number,
    modifiers: OrderItem["modifiers"],
    note: string
  ) {
    const current = orderRef.current;
    if (!current) return;
    // Grab/LINE MAN/ShopeeFood etc. may mark this product's price up (or an admin may have set
    // an exact override for it on this channel) — see `resolveChannelPrice`'s comment. Dine-in
    // (and any channel with no markup set) resolves straight through to `product.price`.
    const channel = channels.find((c) => c.id === current.channelId) ?? null;
    const unitPrice = resolveChannelPrice(product, channel);
    const lineTotal = computeLineTotal(unitPrice, modifiers, quantity);
    const item: OrderItem = {
      id: crypto.randomUUID(),
      productId: product.id,
      productName: resolveItemName(product, modifiers, modifierOptions),
      quantity,
      unitPrice,
      modifiers,
      note,
      lineTotal,
      addedAt: Date.now(),
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
    // A line the kitchen already marked "ทำแล้ว" gets its extra portions as a separate fresh line
    // (see `increaseItemQuantity`) — otherwise the kitchen screen would never show them.
    const newItems = increaseItemQuantity(current.items, item, delta, crypto.randomUUID(), Date.now(), computeLineTotal);
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
    if (appUser) {
      sendKitchenCancellation({ ...current, id: current.id }, [target], catalogSettings, appUser.id).catch(() =>
        setPrintError("ส่งใบยกเลิกเข้าครัวไม่สำเร็จ แจ้งครัวด้วยตัวเอง")
      );
    }
    await auditLogRepository.create({
      shopId,
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
   * Cancels the whole saved order (item: emptying an order line-by-line left the table stuck
   * "occupied" forever — see `CancelOrderDialog`'s comment for the full picture). Sets
   * `status: "CANCELLED"` (freeing the table on the POS home grid the same way a paid checkout
   * does) and writes an audit log entry, then leaves this screen since there's nothing left here
   * to look at.
   */
  async function confirmCancelOrder(reason: AuditReason, note: string) {
    const current = orderRef.current;
    if (!current?.id) return;
    const updatedAt = Date.now();
    await orderRepository.update(current.id, { status: "CANCELLED", updatedAt });
    await auditLogRepository.create({
      shopId,
      action: "ORDER_CANCELLED",
      orderId: current.id,
      description: `ยกเลิกออเดอร์ ${current.orderNumber}`,
      reason,
      reasonNote: reason === "อื่น ๆ" ? note : null,
      performedBy: appUser!.id,
      performedByName: appUser!.name,
      createdAt: updatedAt,
    });
    notifyOrderEvent("cancelled", current);
    if (appUser) {
      // Awaited (unlike remove's) since we navigate away right after — but failures are swallowed.
      await sendKitchenCancellation({ ...current, id: current.id }, current.items, catalogSettings, appUser.id).catch(
        () => false
      );
    }
    if (current.tableId) closeTableSession(current.tableId);
    router.push("/pos");
  }

  /**
   * Moves this saved dine-in order to a different, currently-empty table (e.g. the customer asks
   * to switch seats mid-meal) — see `MoveTableDialog`'s comment for why only empty tables are
   * offered. Writes an `ORDER_TABLE_MOVED` audit entry same as cancel/remove do for their own
   * significant changes (item 18); no reason prompt though, since nothing about the bill itself
   * changed. The local `order` state updates itself via the live `subscribeById` above once the
   * write lands — no need to set it here.
   */
  async function confirmMoveTable(newTable: Table) {
    const current = orderRef.current;
    if (!current?.id || !current.tableId) return;
    const fromTableId = current.tableId;
    const fromTableName = current.tableName;
    const updatedAt = Date.now();
    await orderRepository.update(current.id, { tableId: newTable.id, tableName: newTable.name, updatedAt });
    // The bill just left this table entirely (same "now free" moment as a paid/cancelled
    // checkout, just via a move instead) — close its QR session too, so a photo of *this* table's
    // old QR can't later get mistaken for a brand-new order here once someone new sits down.
    closeTableSession(fromTableId);
    await auditLogRepository.create({
      shopId,
      action: "ORDER_TABLE_MOVED",
      orderId: current.id,
      description: `ย้ายออเดอร์ ${current.orderNumber} จากโต๊ะ ${fromTableName} ไปโต๊ะ ${newTable.name}`,
      reason: null,
      reasonNote: null,
      performedBy: appUser!.id,
      performedByName: appUser!.name,
      createdAt: updatedAt,
    });
    setMoveTableOpen(false);
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
      const orderNumber = await generateOrderNumber(shopId);
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
      if (payload.tableId) {
        // Table orders go through the occupancy check, so two devices opening the same table
        // end up on one order (see `createOrJoinTableOrder`).
        let result: { id: string; joined: boolean };
        try {
          result = await createOrJoinTableOrder(payload, payload.tableId, settings);
        } catch (err) {
          // Firestore rules for `tableOccupancy` not deployed yet on this project
          // (`firebase deploy --only firestore:rules`) — fall back to a plain create rather than
          // leaving the shop unable to open tables at all. Anything else is a real failure.
          if ((err as { code?: string }).code !== "permission-denied") throw err;
          console.error("tableOccupancy rules missing — deploy firestore.rules; creating without the duplicate guard", err);
          result = { id: await orderRepository.create(payload), joined: false };
        }
        const { id, joined } = result;
        if (joined) {
          // Our items now live on the other device's order; the live subscription for that id
          // (after the route change below) loads it with everything on it.
          switchingOrderRef.current = true;
          orderRef.current = null;
          setOrder(null);
          setJoinedNotice(true);
        } else {
          orderRef.current = { ...payload, id };
          setOrder(orderRef.current);
          flashSaved();
        }
        router.replace(`/pos/order/${id}`);
        return id;
      }
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

  const kitchenPrintingOn = Boolean(catalogSettings?.printStation?.kitchenEnabled);

  // "พิมพ์ QR ให้ลูกค้าสั่ง" — only for dine-in, and only in shops that switched it on
  // (Admin → ตั้งค่าร้าน → พิมพ์ QR สั่งอาหารของโต๊ะ); everyone else never sees the button.
  const qrPrintTable =
    catalogSettings?.printStation?.tableQrEnabled && order?.tableId
      ? (tables.find((t) => t.id === order.tableId) ?? null)
      : null;
  async function handlePrintTableQr() {
    if (!qrPrintTable || !catalogSettings || !appUser) return;
    setPrintingQr(true);
    setQrPrintMessage(null);
    try {
      await printQrForTable(qrPrintTable, catalogSettings, appUser);
      setQrPrintMessage({ ok: true, text: "ส่งพิมพ์แล้ว รับที่เครื่องแคชเชียร์" });
    } catch (err) {
      setQrPrintMessage({ ok: false, text: err instanceof Error ? err.message : "ส่งพิมพ์ไม่สำเร็จ" });
    } finally {
      setPrintingQr(false);
    }
  }

  /**
   * Prints a kitchen ticket for everything on this order the kitchen hasn't received yet (see
   * `computeKitchenSend`). There's no "บันทึกออเดอร์" step to hang this on (every tap saves
   * itself), so it runs from the explicit "ส่งครัว" button and automatically on the way out —
   * "กลับหน้าแรก" and "คิดเงิน" — so staff who forget the button still get food to the kitchen.
   * Never throws.
   */
  async function sendToKitchen(): Promise<void> {
    if (!kitchenPrintingOn || !appUser) return;
    // A double tap (or "ส่งครัว" then "คิดเงิน" in quick succession) must not compute the same
    // unsent items twice and print them on two tickets — wait for the in-flight send instead.
    while (sendingToKitchenRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const current = orderRef.current;
    if (!current || countUnsentToKitchen(current.items) === 0) return;
    sendingToKitchenRef.current = true;
    try {
      const id = await ensureSaved();
      const latest = orderRef.current ?? current;
      const result = await sendOrderToKitchen({ ...latest, id }, catalogSettings, appUser.id);
      if (result && orderRef.current) {
        orderRef.current = { ...orderRef.current, items: result.items, kitchenTicketCount: result.kitchenTicketCount };
        setOrder(orderRef.current);
      }
      setPrintError(null);
    } catch {
      setPrintError("ส่งใบสั่งเข้าครัวไม่สำเร็จ ลองกด ส่งครัว อีกครั้ง");
    } finally {
      sendingToKitchenRef.current = false;
    }
  }

  async function handleBackToHome() {
    await sendToKitchen();
    router.push("/pos");
  }

  /** "คิดเงิน": anything still unsent goes to the kitchen first (takeaway orders are often paid
   * right after ordering), then the check bill prints at the cashier, then the dialog opens.
   * The dialog opens even if printing failed. */
  async function handleOpenCheckout() {
    await sendToKitchen();
    const current = orderRef.current;
    if (current && appUser && catalogSettings?.printStation?.checkBillEnabled) {
      try {
        const id = await ensureSaved();
        const latest = orderRef.current ?? current;
        await printCheckBill({ ...latest, id }, catalogSettings, appUser.id, true);
      } catch {
        setPrintError("พิมพ์ใบแจ้งค่าอาหารไม่สำเร็จ");
      }
    }
    setCheckoutOpen(true);
  }

  async function handleReprintCheckBill() {
    const current = orderRef.current;
    if (!current?.id || !appUser) return;
    try {
      await printCheckBill({ ...current, id: current.id }, catalogSettings, appUser.id, false);
    } catch {
      setPrintError("พิมพ์ใบแจ้งค่าอาหารไม่สำเร็จ");
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
        shopId,
        paymentMethodId: payment.paymentMethodId,
        paymentMethodName: payment.paymentMethodName,
        amount: totals.total,
        cashReceived: payment.cashReceived,
        changeDue: payment.changeDue,
        createdBy: appUser!.id,
        createdAt: paidAt,
      });
      // Piece-sold items (water, snacks, bottled drinks) come off the shelf count now — not
      // awaited: a stock write problem must never hold up or undo a completed sale.
      deductStockForPaidOrder({ id, shopId, items: orderRef.current?.items ?? order.items }, appUser!).catch((err) =>
        console.error("deductStockForPaidOrder failed", err)
      );
      notifyOrderEvent("paid", { ...order, total: totals.total, paymentMethodName: payment.paymentMethodName });
      if (order.tableId) closeTableSession(order.tableId);
      // Auto-print the receipt once checkout succeeds — fire-and-forget, deliberately not
      // awaited before navigating away: an unreachable/offline printer has no fetch timeout
      // worth blocking staff on, and the sale itself already went through regardless of whether
      // the receipt actually came out. `catalogSettings` (the real live settings), not the
      // `settings` local fallback above, since `DEFAULT_SETTINGS` has no `receiptPrinterIp` to
      // read. Skipped entirely (not an error) when no printer is configured yet.
      if (catalogSettings?.receiptPrinterIp) {
        const receiptOrder: Order = {
          ...order,
          id,
          status: "PAID",
          paymentStatus: "PAID",
          paymentMethodId: payment.paymentMethodId,
          paymentMethodName: payment.paymentMethodName,
          cashReceived: payment.cashReceived,
          changeDue: payment.changeDue,
          paidAt,
          updatedAt: paidAt,
        };
        void printReceiptViaEpos(catalogSettings.receiptPrinterIp, buildOrderReceipt(receiptOrder, catalogSettings));
      }
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
            <div
              key={product.id}
              className={
                "flex flex-col gap-1.5 rounded-lg border p-3 " +
                (product.active ? "border-border bg-card" : "border-border bg-muted/40 opacity-60")
              }
            >
              <button
                disabled={!product.active}
                onClick={() => handleAddProduct(product)}
                className={"flex flex-col items-start gap-1 text-left " + (product.active ? "hover:opacity-80" : "cursor-not-allowed")}
              >
                <span className={"font-medium" + (product.active ? "" : " line-through")}>{product.name}</span>
                {product.active ? (
                  <span className="text-sm text-muted-foreground">
                    {formatCurrency(resolveChannelPrice(product, currentChannel), settings.currency)}
                  </span>
                ) : (
                  <span className="text-sm font-medium text-destructive">ของหมด</span>
                )}
              </button>
              {product.active
                ? activeDealsAt(product, resolveChannelPrice(product, currentChannel), clock).map((deal) => {
                    const window = dealWindowLabel(deal);
                    return (
                      <button
                        key={`${deal.qty}-${deal.price}-${deal.fromTime ?? ""}-${deal.toTime ?? ""}`}
                        onClick={() => addDealToCart(product, deal)}
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-success bg-success/10 px-3 py-2 text-left text-sm font-semibold text-success hover:bg-success/20"
                      >
                        <span>
                          โปร {deal.qty} ชิ้น {formatCurrency(deal.price, settings.currency)}
                        </span>
                        {window ? <span className="text-xs font-normal">{window}</span> : null}
                      </button>
                    );
                  })
                : null}
              {/* Staff-only quick-add shortcuts (Product.posQuickPresets) — one tap adds the item
                  with its modifiers already picked, no popup. Never shown on the customer-facing
                  self-order screens, which don't read this field at all. */}
              {product.active && product.posQuickPresets && product.posQuickPresets.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {product.posQuickPresets.map((preset) => {
                    const groups = product.modifierGroupIds
                      .map((id) => modifierGroups.find((g) => g.id === id))
                      .filter((g): g is (typeof modifierGroups)[number] => Boolean(g && g.active));
                    const modifiers = resolveModifiersFromSelections(groups, preset.selections, modifierOptions, product.id);
                    const presetPrice =
                      resolveChannelPrice(product, currentChannel) + modifiers.reduce((sum, m) => sum + m.priceDelta, 0);
                    return (
                      <button
                        key={preset.id}
                        onClick={() => handleAddPreset(product, preset)}
                        className="rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                      >
                        {preset.label} · {formatCurrency(presetPrice, settings.currency)}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
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
              {order.customerLabel ? ` · ${order.customerLabel}` : ""}
            </p>
            {order.orderNumber ? (
              <p className="text-xs text-muted-foreground">
                {order.orderNumber} · เปิดโต๊ะเมื่อ {formatTime(order.createdAt)}
              </p>
            ) : null}
            {order.customerClaimedTransfer ? (
              <p className="text-xs font-medium text-destructive">
                ลูกค้าแจ้งว่าโอนแล้ว — กรุณาตรวจสอบยอดในแอปธนาคารก่อนยืนยันรับชำระ
              </p>
            ) : null}
            {qrPrintTable ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={handlePrintTableQr} disabled={printingQr}>
                  {printingQr ? "กำลังส่งพิมพ์..." : "พิมพ์ QR ให้ลูกค้าสั่ง"}
                </Button>
                {qrPrintMessage ? (
                  <span className={"text-xs " + (qrPrintMessage.ok ? "text-success" : "text-destructive")}>
                    {qrPrintMessage.text}
                  </span>
                ) : null}
              </div>
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
          {joinedNotice ? (
            <p className="mb-2 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
              โต๊ะนี้ถูกเปิดจากอีกเครื่องแล้ว รายการทั้งหมดรวมอยู่ในบิลเดียวกัน
            </p>
          ) : null}
          {groupedItems.map((group) => (
            <div key={`${group.productId}::${group.productName}`} className="mb-3 border-b border-border pb-3 last:border-0">
              {group.items.length > 1 ? (
                <p className="mb-2 text-sm font-semibold">
                  {group.productName} x{group.totalQty}
                </p>
              ) : null}
              <div className="grid gap-3">
                {group.items.map((item) => (
                  <div
                    key={item.id}
                    className={
                      highlightedItemIds.has(item.id)
                        ? "-mx-2 rounded-md border-l-4 border-success bg-success/10 px-2 py-1"
                        : undefined
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {/* Grouped (2+ lines of the same product): the header above already shows
                            the name, so each sub-line only needs to show what makes it different —
                            its own note/modifiers — otherwise the product name repeats as usual.
                            The added-at time shows either way, since it differs per line even
                            when the product name doesn't. */}
                        {group.items.length === 1 ? (
                          <p className="font-medium">
                            {item.productName}
                            {item.addedAt ? (
                              <span className="ml-2 font-normal text-muted-foreground">{formatTime(item.addedAt)}</span>
                            ) : null}
                            {highlightedItemIds.has(item.id) ? (
                              <span className="ml-2 rounded-full bg-success/20 px-2 py-0.5 text-xs font-medium text-success">
                                ใหม่
                              </span>
                            ) : null}
                          </p>
                        ) : item.addedAt ? (
                          <p className="text-xs text-muted-foreground">{formatTime(item.addedAt)}</p>
                        ) : null}
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
            {totals.promoDiscount > 0 ? (
              <div className="flex justify-between font-medium text-success">
                <span>ส่วนลดโปรโมชั่น</span>
                <span>-{formatCurrency(totals.promoDiscount, settings.currency)}</span>
              </div>
            ) : null}
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
          {printError ? <p className="mb-2 text-sm text-destructive">{printError}</p> : null}
          {kitchenPrintingOn && countUnsentToKitchen(order.items) > 0 ? (
            <Button variant="secondary" className="mb-2 w-full" onClick={sendToKitchen} disabled={saving}>
              ส่งครัว ({countUnsentToKitchen(order.items)} ที่)
            </Button>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {/* No manual "บันทึกออเดอร์" step — every menu tap saves itself (see `applyItems`).
                This button is just navigation, available whether or not anything's been added yet. */}
            <Button variant="outline" onClick={handleBackToHome}>
              กลับหน้าแรก
            </Button>
            <Button onClick={handleOpenCheckout} disabled={saving || order.items.length === 0}>
              คิดเงิน
            </Button>
          </div>
          {/* Only a *saved* order can be stuck occupying a table — an unsaved draft has nothing
              to cancel, staff just tap "กลับหน้าแรก" above and it's gone (see `confirmCancelOrder`'s
              comment). Full-width and visually separated so it doesn't get mistaken for one more
              routine action alongside the two above it. */}
          {/* Only a dine-in order has a table to move — takeaway/Grab/etc. orders (tableId: null)
              never show this. Same "already saved" guard as cancel above: an unsaved draft has
              nothing in Firestore yet to move. */}
          {order.id && order.tableId ? (
            <Button
              variant="outline"
              className="mt-2 w-full"
              onClick={() => setMoveTableOpen(true)}
            >
              ย้ายโต๊ะ
            </Button>
          ) : null}
          {order.id ? (
            <Button
              variant="ghost"
              className="mt-2 w-full text-destructive"
              onClick={() => setCancelOpen(true)}
            >
              ยกเลิกออเดอร์
            </Button>
          ) : null}
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

      {order.id ? (
        <CancelOrderDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          orderNumber={order.orderNumber}
          onConfirm={confirmCancelOrder}
        />
      ) : null}

      {order.id && order.tableId ? (
        <MoveTableDialog
          open={moveTableOpen}
          onOpenChange={setMoveTableOpen}
          currentTableName={order.tableName}
          emptyTables={emptyTables}
          onConfirm={confirmMoveTable}
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
        items={order.items}
        totals={totals}
        currency={settings.currency}
        paymentMethods={paymentMethods.filter((m) => m.active)}
        saving={saving}
        onConfirm={handleConfirmPayment}
        onReprintCheckBill={catalogSettings?.printStation?.checkBillEnabled && order.id ? handleReprintCheckBill : undefined}
      />
    </div>
  );
}
