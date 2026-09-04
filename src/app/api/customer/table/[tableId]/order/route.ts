import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { resolveCustomerOrder, type CustomerSelection } from "@/lib/pos/customerOrder";
import { CUSTOMER_ORDER_MIN_INTERVAL_MS, isThrottled } from "@/lib/pos/customerThrottle";
import { generateOrderNumberAdmin } from "@/lib/pos/orderNumberAdmin";
import { computeOrderTotals } from "@/lib/pos/pricing";
import type {
  ModifierGroup,
  ModifierOption,
  Order,
  OrderItem,
  Product,
  SalesChannel,
  ShopSettings,
  Table,
} from "@/types";

const MAX_LINES_PER_SUBMISSION = 20;

/**
 * Submits a customer's QR-order cart straight onto the table's running bill (the shop's choice —
 * see progress.md's "PWA"/reports entries for the discussion pattern this followed). No auth,
 * by design (a diner shouldn't need an account to order), so every trust decision below is made
 * server-side against live data — see `lib/pos/customerOrder.ts`'s header for why prices never
 * come from the request.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  const db = getAdminDb();

  const tableSnap = await db.collection(COLLECTIONS.tables).doc(tableId).get();
  if (!tableSnap.exists) {
    return NextResponse.json({ error: "ไม่พบโต๊ะนี้" }, { status: 404 });
  }
  const table = { ...tableSnap.data(), id: tableSnap.id } as Table;
  if (table.shopId !== DEFAULT_SHOP_ID || !table.active) {
    return NextResponse.json({ error: "โต๊ะนี้ปิดใช้งานอยู่" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { items?: CustomerSelection[] } | null;
  const selections = body?.items;
  if (!Array.isArray(selections) || selections.length === 0) {
    return NextResponse.json({ error: "ไม่มีรายการสั่ง" }, { status: 400 });
  }
  if (selections.length > MAX_LINES_PER_SUBMISSION) {
    return NextResponse.json({ error: `สั่งได้ไม่เกิน ${MAX_LINES_PER_SUBMISSION} รายการต่อครั้ง` }, { status: 400 });
  }

  const [productsSnap, groupsSnap, optionsSnap, channelsSnap, settingsSnap] = await Promise.all([
    db.collection(COLLECTIONS.products).where("shopId", "==", DEFAULT_SHOP_ID).where("active", "==", true).get(),
    db.collection(COLLECTIONS.modifierGroups).where("shopId", "==", DEFAULT_SHOP_ID).where("active", "==", true).get(),
    db.collection(COLLECTIONS.modifierOptions).where("shopId", "==", DEFAULT_SHOP_ID).where("active", "==", true).get(),
    db.collection(COLLECTIONS.salesChannels).where("shopId", "==", DEFAULT_SHOP_ID).where("active", "==", true).get(),
    db.collection(COLLECTIONS.shopSettings).doc(DEFAULT_SHOP_ID).get(),
  ]);

  const catalog = {
    products: productsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Product),
    modifierGroups: groupsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as ModifierGroup),
    modifierOptions: optionsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as ModifierOption),
  };
  const settings = settingsSnap.exists ? ({ ...settingsSnap.data(), id: settingsSnap.id } as ShopSettings) : null;
  const dineInChannel = channelsSnap.docs
    .map((d) => ({ ...d.data(), id: d.id }) as SalesChannel)
    .find((c) => c.requiresTable);

  if (!settings || !dineInChannel) {
    return NextResponse.json({ error: "ร้านยังไม่พร้อมรับออเดอร์ กรุณาแจ้งพนักงาน" }, { status: 503 });
  }

  const { items: resolvedItems, errors } = resolveCustomerOrder(selections, catalog);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(", ") }, { status: 400 });
  }

  // `newSinceReview` marks these as unseen so `OrderScreen` can highlight exactly these lines
  // (not the whole order) once staff opens it — see the field's comment in `types/order.ts`.
  const newItems: OrderItem[] = resolvedItems.map((item) => ({ ...item, id: randomUUID(), newSinceReview: true }));

  const throttleRef = db.collection(COLLECTIONS.customerOrderThrottle).doc(tableId);
  const ordersRef = db.collection(COLLECTIONS.orders);
  const openOrderQuery = ordersRef
    .where("shopId", "==", DEFAULT_SHOP_ID)
    .where("tableId", "==", tableId)
    .where("status", "==", "OPEN")
    .limit(1);

  // Firestore transactions can't nest (`generateOrderNumberAdmin` runs its own transaction), so
  // the order number — only needed for a brand-new order — is allocated in its own short
  // transaction *before* the main one starts, based on a plain (non-transactional) check for
  // whether this table already has an open order. If a concurrent request wins the race and an
  // open order shows up by the time the main transaction actually commits, the code below simply
  // appends to that order instead and this pre-allocated number goes unused — a skipped sequence
  // number, same acceptable gap a voided order already leaves, never a duplicate order.
  const precheckSnap = await openOrderQuery.get();
  const preAllocatedOrderNumber = precheckSnap.empty ? await generateOrderNumberAdmin(db, DEFAULT_SHOP_ID) : null;

  try {
    const orderId = await db.runTransaction(async (tx) => {
      const [throttleSnap, openOrderSnap] = await Promise.all([tx.get(throttleRef), tx.get(openOrderQuery)]);

      const lastSubmittedAt = throttleSnap.exists ? (throttleSnap.data()!.lastSubmittedAt as number) : null;
      const now = Date.now();
      if (isThrottled(lastSubmittedAt, now)) {
        throw new ThrottledError();
      }

      if (!openOrderSnap.empty) {
        const orderDoc = openOrderSnap.docs[0];
        const order = orderDoc.data() as Order;
        const mergedItems = [...order.items, ...newItems];
        const totals = computeOrderTotals(mergedItems, settings, order.discount);
        // Flags this table for the badge + alert sound on the POS home screen (`PosHome`) until
        // a staff member actually opens the order — see `Order.pendingReview`'s comment.
        tx.update(orderDoc.ref, { items: mergedItems, ...totals, updatedAt: now, pendingReview: true });
        tx.set(throttleRef, { lastSubmittedAt: now });
        return orderDoc.id;
      }

      const newOrderRef = ordersRef.doc();
      const totals = computeOrderTotals(newItems, settings);
      const orderData: Omit<Order, "id"> = {
        // Falls back to allocating on the spot in the rare case the precheck raced with another
        // request that also saw "no open order" — see the comment above `precheckSnap`.
        orderNumber: preAllocatedOrderNumber ?? (await generateOrderNumberAdmin(db, DEFAULT_SHOP_ID)),
        shopId: DEFAULT_SHOP_ID,
        orderType: "dineIn",
        channelId: dineInChannel.id,
        channelName: dineInChannel.name,
        tableId: table.id,
        tableName: table.name,
        status: "OPEN",
        items: newItems,
        ...totals,
        paymentStatus: "UNPAID",
        paymentMethodId: null,
        paymentMethodName: null,
        cashReceived: null,
        changeDue: null,
        // No real staff account placed this order — a plain sentinel, not a Firestore user id,
        // so it reads clearly as "customer, not staff" everywhere an order's createdBy is shown.
        createdBy: "customer-qr",
        createdByName: "ลูกค้า (สแกน QR)",
        createdAt: now,
        updatedAt: now,
        paidAt: null,
        pendingReview: true,
      };
      tx.set(newOrderRef, orderData);
      tx.set(throttleRef, { lastSubmittedAt: now });
      return newOrderRef.id;
    });

    return NextResponse.json({ ok: true, orderId, addedCount: newItems.length });
  } catch (error) {
    if (error instanceof ThrottledError) {
      return NextResponse.json(
        { error: "เพิ่งสั่งไปเมื่อครู่ กรุณารอสักครู่แล้วลองใหม่" },
        { status: 429, headers: { "Retry-After": String(Math.ceil(CUSTOMER_ORDER_MIN_INTERVAL_MS / 1000)) } }
      );
    }
    throw error;
  }
}

class ThrottledError extends Error {}
