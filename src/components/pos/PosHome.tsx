"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { channelRepository } from "@/repositories/channelRepository";
import { orderRepository } from "@/repositories/orderRepository";
import { shopRepository } from "@/repositories/shopRepository";
import { tableRepository } from "@/repositories/tableRepository";
import type { Order, SalesChannel, Table } from "@/types";

/**
 * POS home (item 5): the table grid plus the big non-table channel buttons. A table's
 * occupied/free state and running total are derived by joining the live open-orders list
 * against tables/channels client-side — `Table` itself carries no status field (see
 * Milestone 3 plan: "table occupancy is derived, not stored").
 */
export function PosHome() {
  const [tables, setTables] = useState<Table[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [currency, setCurrency] = useState("THB");

  useEffect(() => tableRepository.subscribeForShop(DEFAULT_SHOP_ID, setTables), []);
  useEffect(() => channelRepository.subscribeForShop(DEFAULT_SHOP_ID, setChannels), []);
  useEffect(() => orderRepository.subscribeOpenForShop(DEFAULT_SHOP_ID, setOpenOrders), []);
  useEffect(() => {
    shopRepository.getSettings(DEFAULT_SHOP_ID).then((s) => {
      if (s) setCurrency(s.currency);
    });
  }, []);

  const activeTables = tables.filter((t) => t.active);
  const otherChannels = channels.filter((c) => c.active && !c.requiresTable);
  const pendingOtherOrders = openOrders.filter((o) => o.tableId === null);
  const orderForTable = (tableId: string) => openOrders.find((o) => o.tableId === tableId);

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <section>
        <h1 className="mb-3 text-lg font-semibold">โต๊ะ</h1>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {activeTables.map((table) => {
            const order = orderForTable(table.id);
            return (
              <Link
                key={table.id}
                href={
                  order
                    ? `/pos/order/${order.id}`
                    : `/pos/order/new?tableId=${table.id}`
                }
                className={
                  "flex flex-col items-center justify-center gap-1 rounded-lg border p-4 h-24 " +
                  (order
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:bg-accent")
                }
              >
                <span className="text-lg font-semibold">{table.name}</span>
                {order ? (
                  <Badge variant="default">{formatCurrency(order.total, currency)}</Badge>
                ) : (
                  <Badge variant="muted">ว่าง</Badge>
                )}
              </Link>
            );
          })}
          {activeTables.length === 0 ? (
            <p className="col-span-full text-sm text-muted-foreground">
              ยังไม่มีโต๊ะ — ไปเพิ่มที่หน้า Admin ก่อน
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-6">
        <h1 className="mb-3 text-lg font-semibold">ช่องทางอื่น</h1>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {otherChannels.map((channel) => (
            <Link
              key={channel.id}
              href={`/pos/order/new?channelId=${channel.id}`}
              className="flex h-24 items-center justify-center rounded-lg border border-border bg-card p-4 text-center text-lg font-semibold hover:bg-accent"
              style={{ borderColor: channel.color }}
            >
              {channel.name}
            </Link>
          ))}
        </div>
      </section>

      {pendingOtherOrders.length > 0 ? (
        <section className="mt-6">
          <h1 className="mb-3 text-lg font-semibold">ออเดอร์ค้างอยู่</h1>
          <div className="grid gap-2">
            {pendingOtherOrders.map((order) => (
              <Link
                key={order.id}
                href={`/pos/order/${order.id}`}
                className="flex items-center justify-between rounded-lg border border-border bg-card p-3 hover:bg-accent"
              >
                <span>
                  {order.channelName} — {order.orderNumber}
                </span>
                <Badge variant="default">{formatCurrency(order.total, currency)}</Badge>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-6">
        <Link href="/pos/history" className="text-sm text-muted-foreground underline">
          ประวัติออเดอร์
        </Link>
      </div>
    </main>
  );
}
