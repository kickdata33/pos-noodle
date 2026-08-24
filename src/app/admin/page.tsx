import Link from "next/link";

const SHORTCUTS = [
  { href: "/admin/categories", label: "หมวดหมู่", desc: "ก๋วยเตี๋ยว, เกาเหลา, ลูกชิ้น, ..." },
  { href: "/admin/products", label: "เมนู", desc: "เพิ่ม/แก้ราคา/เปิดปิดเมนู" },
  { href: "/admin/modifiers", label: "Modifier", desc: "เส้น, พิเศษ, ไม่งอก, ..." },
  { href: "/admin/tables", label: "โต๊ะ", desc: "เพิ่ม/ลบ/เปลี่ยนชื่อโต๊ะ" },
  { href: "/admin/channels", label: "ช่องทางขาย", desc: "หน้าร้าน, Grab, LINE MAN, ..." },
  { href: "/admin/payment-methods", label: "วิธีชำระเงิน", desc: "เงินสด, QR, Delivery" },
  { href: "/admin/staff", label: "พนักงาน", desc: "เพิ่มพนักงาน, ตั้ง/รีเซ็ต PIN" },
  { href: "/admin/settings", label: "ตั้งค่าร้าน", desc: "ชื่อร้าน, ที่อยู่, ใบเสร็จ, VAT" },
];

export default function AdminHomePage() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-xl font-semibold">Admin</h1>
      <p className="mt-2 text-muted-foreground">จัดการข้อมูลร้านทั้งหมดได้จากที่นี่</p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SHORTCUTS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent"
          >
            <p className="font-medium">{item.label}</p>
            <p className="mt-1 text-sm text-muted-foreground">{item.desc}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
