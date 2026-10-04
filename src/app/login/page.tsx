import type { Metadata } from "next";
import { AuthPage } from "@/components/auth/auth-page";
import { courseReturnTo } from "@/lib/return-to";
import { currentAccount } from "@/server/auth/service";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "تسجيل الدخول" };
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await currentAccount();
  if (account) redirect(account.role === "admin" ? "/admin" : "/my-courses");
  const query = await searchParams;
  return (
    <>
      {query.created === "1" && (
        <p className="status-message" role="status">
          حسابك اتعمل. ادخل برقمك وكلمة السر علشان تبدأ.
        </p>
      )}
      <AuthPage mode="login" returnTo={courseReturnTo(query.next)} />
    </>
  );
}
