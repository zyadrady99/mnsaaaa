import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { currentAccount } from "@/server/auth/service";
export async function AccountMenu() {
  const account = await currentAccount();
  return (
    <div className="header-actions">
      {account ? (
        <>
          <Link
            className="button primary small"
            href={account.role === "admin" ? "/admin" : "/account"}
          >
            {account.role === "admin" ? "لوحة الإدارة" : "حسابي"}
            <ArrowLeft size={17} aria-hidden="true" />
          </Link>
        </>
      ) : (
        <>
          <Link className="login-link" href="/login">
            دخول
          </Link>
          <Link className="button primary small" href="/register">
            إنشاء حساب
            <ArrowLeft size={17} aria-hidden="true" />
          </Link>
        </>
      )}
    </div>
  );
}
