import { AdminShell } from "@/components/admin-shell";
import { requireAccount } from "@/server/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const account = await requireAccount("admin");
  return <AdminShell adminName={account.full_name}>{children}</AdminShell>;
}
