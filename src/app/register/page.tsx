import type { Metadata } from "next";
import { AuthPage } from "@/components/auth/auth-page";
import { courseReturnTo } from "@/lib/return-to";
import { currentAccount } from "@/server/auth/service";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "إنشاء حساب" };
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await currentAccount();
  if (account) redirect(account.role === "admin" ? "/admin" : "/my-courses");
  return (
    <AuthPage
      mode="register"
      returnTo={courseReturnTo((await searchParams).next)}
    />
  );
}
