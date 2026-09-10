import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { resolveCustomerOrder, type CustomerSelection } from "@/lib/pos/customerOrder";
import { generateOrderNumberAdmin } from "@/lib/pos/orderNumberAdmin";
import { computeOrderTotals } from "@/lib/pos/pricing";
import { generatePromptPayPayload } from "@/lib/pos/promptpay";
import { generateQueueNumberAdmin } from "@/lib/pos/queueNumberAdmin";
import type {
  ModifierGroup,
  ModifierOption,
  Order,
  OrderItem,
  Product,
  SalesChannel,
  ShopSettings,
} from "@/types";

const MAX_LINES_PER_SUBMISSION = 20;
const MAX_CUSTOMER_NAME_LENGTH = 40;

interface RequestBody {
  items?: CustomerSelection[];
  customerName?: string;
  paymentIntent?: "cash" | "transfer";
}

/**
 * Submits a takeaway self-order — always a brand-new order, never merged into an existing one
 * the way the table flow merges repeat scans into the same running bill (a "กลับบ้าน" order has
 * no natural notion of "the same visit" to merge into without a table or a login). No per-request
 * throttle like the table route has either: there's no natural per-customer key to throttle on
 * here (no table, no session), and a double-tap just creates two separate orders — a nuisance
 * staff can clear with the cancel-order flow, not a runaway-merge risk the throttle exists for.
 *
 * Identifies the order to staff either with an auto-issued daily queue number or a name the
 * customer typed in, per `ShopSettings.pickupIdentificationMode` — decided here, server-side,
 * never trusting which mode the client *thinks* is active (a stale page load, or a deliberately
 * crafted request, must not be able to skip straight to a name in queue mode or vice versa).
 */
export async function POST(request: NextRequest) {
  const db = getAdminDb();
  const shopId = DEFAULT_SHOP_ID;

  const body = (await request.json().catch(() => null)) as RequestBody | null;
  const selections = body?.items;
  if (!Array.isArray(selections) || selections.length === 0) {
    return NextResponse.json({ error: "ไม่มีรายการสั่ง" }, { status: 400 });
  }
  if (selections.length > MAX_LINES_PER_SUBMISSION) {
    return NextResponse.json({ error: `สั่งได้ไม่เกิน ${MAX_LINES_PER_SUBMISSION} รายการต่อครั้ง` }, { status: 400 });
  }
  const paymentIntent = body?.paymentIntent;
  if (paymentIntent !== "cash" && paymentIntent !== "transfer") {
    return NextResponse.json({ error: "กรุณาเลือกวิธีชำระเงิน" }, { status: 400 });
  }

  const [productsSnap, groupsSnap, optionsSnap, channelsSnap, settingsSnap] = await Promise.all([
    db.collection(COLLECTIONS.products).where("shopId", "==", shopId).where("active", "==", true).get(),
    db.collection(COLLECTIONS.modifierGroups).where("shopId", "==", shopId).where("active", "==", true).get(),
    db.collection(COLLECTIONS.modifierOptions).where("shopId", "==", shopId).where("active", "==", true).get(),
    db.collection(COLLECTIONS.salesChannels).where("shopId", "==", shopId).where("active", "==", true).get(),
    db.collection(COLLECTIONS.shopSettings).doc(shopId).get(),
  ]);

  const catalog = {
    products: productsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as Product),
    modifierGroups: groupsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as ModifierGroup),
    modifierOptions: optionsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as ModifierOption),
  };
  const settings = settingsSnap.exists ? ({ ...settingsSnap.data(), id: settingsSnap.id } as ShopSettings) : null;
  // "กลับบ้าน" is a fixed, seeded channel (`code: "takeaway"`) — looked up by code, never
  // hardcoded by id, same reasoning as every other channel lookup in this app (item 34).
  const takeawayChannel = channelsSnap.docs
    .map((d) => ({ ...d.data(), id: d.id }) as SalesChannel)
    .find((c) => c.code === "takeaway");

  if (!settings || !takeawayChannel) {
    return NextResponse.json({ error: "ร้านยังไม่พร้อมรับออเดอร์ กรุณาแจ้งพนักงาน" }, { status: 503 });
  }
  if (paymentIntent === "transfer" && !settings.promptPayId) {
    return NextResponse.json({ error: "ร้านยังไม่เปิดรับโอนพร้อมเพย์ กรุณาเลือกเงินสด" }, { status: 400 });
  }

  const { items: resolvedItems, errors } = resolveCustomerOrder(selections, { ...catalog, channel: takeawayChannel });
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(", ") }, { status: 400 });
  }

  let customerLabel: string;
  if (settings.pickupIdentificationMode === "name") {
    const name = (body?.customerName ?? "").trim().slice(0, MAX_CUSTOMER_NAME_LENGTH);
    if (!name) {
      return NextResponse.json({ error: "กรุณากรอกชื่อ" }, { status: 400 });
    }
    customerLabel = name;
  } else {
    // Queue mode ignores anything the client sent for a name — never trusted for identification
    // either way, same rule as everything else in this route.
    const queueNumber = await generateQueueNumberAdmin(db, shopId);
    customerLabel = `คิว ${queueNumber}`;
  }

  const newItems: OrderItem[] = resolvedItems.map((item) => ({ ...item, id: randomUUID() }));
  const totals = computeOrderTotals(newItems, settings);
  const now = Date.now();
  const orderNumber = await generateOrderNumberAdmin(db, shopId);

  const orderData: Omit<Order, "id"> = {
    orderNumber,
    shopId,
    orderType: "other",
    channelId: takeawayChannel.id,
    channelName: takeawayChannel.name,
    tableId: null,
    tableName: null,
    status: "OPEN",
    items: newItems,
    ...totals,
    paymentStatus: "UNPAID",
    paymentMethodId: null,
    paymentMethodName: null,
    cashReceived: null,
    changeDue: null,
    createdBy: "customer-pickup-qr",
    createdByName: "ลูกค้า (สั่งกลับบ้าน)",
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    // Reuses the same badge/blink/alert-sound mechanism the dine-in QR flow already has on the
    // POS home screen — see `PosHome`'s subscription and the pending-orders section below it.
    pendingReview: true,
    customerLabel,
    pickupPaymentIntent: paymentIntent,
  };

  const orderRef = db.collection(COLLECTIONS.orders).doc();
  await orderRef.set(orderData);

  return NextResponse.json({
    ok: true,
    orderId: orderRef.id,
    customerLabel,
    total: totals.total,
    promptPayPayload:
      paymentIntent === "transfer" ? generatePromptPayPayload(settings.promptPayId!, totals.total) : null,
  });
}
