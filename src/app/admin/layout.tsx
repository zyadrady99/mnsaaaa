import Link from "next/link";
import { requireAccount } from "@/server/auth";
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAccount("admin");
  return (
    <div className="admin-workspace">
      <nav className="admin-nav" aria-label="أقسام الإدارة">
        <Link href="/admin">نظرة عامة</Link>
        <Link href="/admin/teachers">المدرسون</Link>
        <Link href="/admin/courses">الكورسات</Link>
        <Link href="/admin/codes">الأكواد</Link>
        <Link href="/admin/students">الطلاب</Link>
        <Link href="/admin/settings">الصفوف والمواد</Link>
        <Link href="/admin/audit">سجل الإجراءات</Link>
      </nav>
      {children}
    </div>
  );
}
