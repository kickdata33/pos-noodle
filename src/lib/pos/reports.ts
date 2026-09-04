import type { Order } from "@/types";
import { bangkokDateKey, bangkokHour, dateKeysBetween } from "./dateRange";

/**
 * Pure aggregation over an already-fetched list of PAID orders (fetched by
 * `orderRepository.listPaidForShopInRange`, see that method's comment for why the range filter
 * is on `paidAt` not `createdAt`). Kept pure/synchronous so it's unit-testable without Firestore
 * and reusable across every card/chart on the report page from a single fetch.
 */

/** Revenue-recognition timestamp for an order — `paidAt` should always be set on a PAID order,
 * but a defensive fallback avoids a report card blowing up over one malformed historical row. */
function recognizedAt(order: Order): number {
  return order.paidAt ?? order.createdAt;
}

export interface ReportSummary {
  revenue: number;
  orderCount: number;
  itemCount: number;
  avgOrderValue: number;
}

export function summarizeOrders(orders: Order[]): ReportSummary {
  const revenue = round2(orders.reduce((sum, o) => sum + o.total, 0));
  const orderCount = orders.length;
  const itemCount = orders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
  return {
    revenue,
    orderCount,
    itemCount,
    avgOrderValue: orderCount ? round2(revenue / orderCount) : 0,
  };
}

export interface ProductSales {
  productId: string;
  productName: string;
  qty: number;
  revenue: number;
}

/** สินค้าขายดี — ranked by quantity sold (ties broken by revenue), across every order's items. */
export function topProducts(orders: Order[], limit = 10): ProductSales[] {
  const byProduct = new Map<string, ProductSales>();
  for (const order of orders) {
    for (const item of order.items) {
      const entry = byProduct.get(item.productId) ?? {
        productId: item.productId,
        productName: item.productName,
        qty: 0,
        revenue: 0,
      };
      entry.qty += item.quantity;
      entry.revenue = round2(entry.revenue + item.lineTotal);
      byProduct.set(item.productId, entry);
    }
  }
  return [...byProduct.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, limit);
}

export interface DailySales {
  dateKey: string;
  revenue: number;
  orderCount: number;
}

/** One point per calendar day across the whole range, including zero-revenue days — a trend
 * chart with days silently missing reads as broken, not as "no sales that day". */
export function dailySales(orders: Order[], startKey: string, endKey: string): DailySales[] {
  const byDay = new Map<string, DailySales>();
  for (const key of dateKeysBetween(startKey, endKey)) {
    byDay.set(key, { dateKey: key, revenue: 0, orderCount: 0 });
  }
  for (const order of orders) {
    const key = bangkokDateKey(recognizedAt(order));
    const entry = byDay.get(key);
    if (!entry) continue; // outside the requested range — shouldn't happen, but never crash a report over it
    entry.revenue = round2(entry.revenue + order.total);
    entry.orderCount += 1;
  }
  return [...byDay.values()];
}

export interface HourlySales {
  hour: number;
  orderCount: number;
  revenue: number;
}

/** ช่วงเวลาไหนคนกินเยอะ — bill count by hour of day (0–23), every hour present even at zero. */
export function hourlySales(orders: Order[]): HourlySales[] {
  const byHour: HourlySales[] = Array.from({ length: 24 }, (_, hour) => ({ hour, orderCount: 0, revenue: 0 }));
  for (const order of orders) {
    const entry = byHour[bangkokHour(recognizedAt(order))];
    entry.orderCount += 1;
    entry.revenue = round2(entry.revenue + order.total);
  }
  return byHour;
}

export interface BreakdownEntry {
  key: string;
  label: string;
  revenue: number;
  orderCount: number;
}

function breakdownBy(orders: Order[], keyOf: (order: Order) => { key: string; label: string }): BreakdownEntry[] {
  const byKey = new Map<string, BreakdownEntry>();
  for (const order of orders) {
    const { key, label } = keyOf(order);
    const entry = byKey.get(key) ?? { key, label, revenue: 0, orderCount: 0 };
    entry.revenue = round2(entry.revenue + order.total);
    entry.orderCount += 1;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.revenue - a.revenue);
}

export function salesByChannel(orders: Order[]): BreakdownEntry[] {
  return breakdownBy(orders, (o) => ({ key: o.channelId, label: o.channelName }));
}

export function salesByPaymentMethod(orders: Order[]): BreakdownEntry[] {
  return breakdownBy(orders, (o) => ({
    key: o.paymentMethodId ?? "unknown",
    label: o.paymentMethodName ?? "ไม่ระบุ",
  }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
