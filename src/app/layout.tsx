import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { cookies } from "next/headers";
import { Flask } from "@phosphor-icons/react/dist/ssr";
import { Suspense } from "react";
import { AccountMenu } from "@/components/account-menu";
import { Brand } from "@/components/brand";
import { Navigation } from "@/components/navigation";
import { ThemeProvider, ThemeToggle } from "@/components/theme-provider";
import { themeCookie, themeFromCookie } from "@/lib/theme";
import "./globals.css";

const cairo = localFont({
  src: [
    { path: "../fonts/cairo-latin.woff2", weight: "200 1000", style: "normal" },
    {
      path: "../fonts/cairo-arabic.woff2",
      weight: "200 1000",
      style: "normal",
    },
  ],
  variable: "--font-arabic",
  display: "swap",
  fallback: ["Arial"],
});
export const metadata: Metadata = {
  title: { default: "دروسنا — خطوة بخطوة", template: "%s | دروسنا" },
  description:
    "واجهة دروسنا التجريبية: اكتشف المدرسين والكورسات للمرحلة الثانوية.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const preferences = await cookies();
  const initialTheme = themeFromCookie(
    preferences.get(themeCookie)?.value ??
      preferences.get("dorosna_admin_theme")?.value,
  );
  return (
    <html
      lang="ar"
      dir="rtl"
      data-scroll-behavior="smooth"
      data-theme={initialTheme}
    >
      <body className={cairo.variable}>
        <ThemeProvider initialTheme={initialTheme}>
          <a className="skip-link" href="#main">
            انتقل للمحتوى
          </a>
          <aside className="preview-banner" aria-label="حالة المعاينة">
            <div className="container">
              <span>
                <Flask size={17} aria-hidden="true" />
                نسخة محلية للتجربة · المحتوى الدراسي بيانات تجريبية
              </span>
              <span className="preview-note">
                جرّب الحسابات والوظائف قبل النشر
              </span>
            </div>
          </aside>
          <header className="site-header">
            <div className="container header-inner">
              <Brand />
              <Navigation />
              <div className="header-tools">
                <ThemeToggle />
                <Suspense
                  fallback={<div className="header-actions" aria-busy="true" />}
                >
                  <AccountMenu />
                </Suspense>
              </div>
            </div>
          </header>
          <main id="main" className="container main-content" tabIndex={-1}>
            {children}
          </main>
          <footer className="site-footer container">
            <span>
              دروسنا <span className="muted">· نتعلم خطوة بخطوة</span>
            </span>
            <div>
              <Link href="/courses">كل الكورسات</Link>
              <Link href="/help">المساعدة</Link>
            </div>
          </footer>
          <Navigation mobile />
        </ThemeProvider>
      </body>
    </html>
  );
}
