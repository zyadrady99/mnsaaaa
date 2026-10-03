"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import {
  ArrowSquareOut,
  BookOpen,
  BookOpenText,
  CaretLeft,
  ChalkboardTeacher,
  ClockCounterClockwise,
  ClipboardText,
  House,
  List,
  SlidersHorizontal,
  Ticket,
  UserCircle,
  Users,
  X,
} from "@phosphor-icons/react";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle, useTheme } from "@/components/theme-provider";

const groups = [
  {
    label: "المنصة",
    links: [{ href: "/admin", label: "نظرة عامة", icon: House }],
  },
  {
    label: "المحتوى التعليمي",
    links: [
      { href: "/admin/teachers", label: "المدرسون", icon: ChalkboardTeacher },
      { href: "/admin/courses", label: "الكورسات", icon: BookOpen },
      { href: "/admin/assessments", label: "التقييمات", icon: ClipboardText },
    ],
  },
  {
    label: "الاشتراكات والطلاب",
    links: [
      { href: "/admin/codes", label: "أكواد الاشتراك", icon: Ticket },
      { href: "/admin/students", label: "الطلاب", icon: Users },
    ],
  },
  {
    label: "الإعدادات والمراجعة",
    links: [
      {
        href: "/admin/settings",
        label: "الصفوف والمواد",
        icon: SlidersHorizontal,
      },
      {
        href: "/admin/audit",
        label: "سجل الإجراءات",
        icon: ClockCounterClockwise,
      },
    ],
  },
];

export function AdminShell({
  children,
  adminName,
}: {
  children: React.ReactNode;
  adminName: string;
}) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const { theme } = useTheme();
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuOpen = openPath === pathname;
  const current = groups
    .flatMap((group) => group.links)
    .find((link) =>
      link.href === "/admin"
        ? pathname === link.href
        : pathname === link.href || pathname.startsWith(`${link.href}/`),
    );
  const nested = current && pathname !== current.href;

  return (
    <div
      className="admin-workspace"
      data-theme={theme}
      data-menu-open={menuOpen}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          setOpenPath(null);
          menuButton.current?.focus();
        }
      }}
    >
      <a className="skip-link" href="#admin-content">
        انتقل لمحتوى الإدارة
      </a>
      <header className="admin-topbar">
        <div className="admin-topbar-start">
          <button
            ref={menuButton}
            type="button"
            className="admin-menu-toggle admin-icon-button"
            aria-expanded={menuOpen}
            aria-controls="admin-sidebar"
            aria-label={menuOpen ? "إغلاق أقسام الإدارة" : "فتح أقسام الإدارة"}
            onClick={() => setOpenPath(menuOpen ? null : pathname)}
          >
            {menuOpen ? (
              <X size={23} aria-hidden="true" />
            ) : (
              <List size={23} aria-hidden="true" />
            )}
          </button>
          <nav className="admin-breadcrumbs" aria-label="مسار لوحة الإدارة">
            <Link href="/admin">لوحة الإدارة</Link>
            <CaretLeft size={14} aria-hidden="true" />
            {nested && current ? (
              <>
                <Link href={current.href}>{current.label}</Link>
                <CaretLeft size={14} aria-hidden="true" />
                <span aria-current="page">
                  {pathname.startsWith("/admin/assessments/")
                    ? "إعداد التقييم"
                    : pathname.endsWith("/new")
                      ? "إضافة كورس"
                      : "التفاصيل"}
                </span>
              </>
            ) : (
              <span aria-current="page">{current?.label ?? "الإدارة"}</span>
            )}
          </nav>
        </div>
        <div className="admin-topbar-actions">
          <ThemeToggle className="admin-theme-toggle admin-icon-button" />
          <Link
            href="/account"
            className="admin-user"
            aria-label={`حساب ${adminName}`}
          >
            <span className="admin-avatar" aria-hidden="true">
              {adminName.trim().slice(0, 1)}
            </span>
            <span>
              <strong>{adminName}</strong>
              <small>مدير المنصة</small>
            </span>
          </Link>
        </div>
      </header>
      <aside className="admin-sidebar" id="admin-sidebar">
        <Link
          href="/admin"
          className="admin-brand"
          aria-label="دروسنا — لوحة الإدارة"
          onClick={() => setOpenPath(null)}
        >
          <span className="admin-brand-mark">
            <BookOpenText size={28} weight="bold" aria-hidden="true" />
          </span>
          <span>
            دروسنا<small>لوحة الإدارة</small>
          </span>
        </Link>
        <nav className="admin-sidebar-nav" aria-label="أقسام الإدارة">
          {groups.map((group) => (
            <div className="admin-nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.links.map(({ href, label, icon: Icon }) => {
                const active = current?.href === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    className="admin-nav-link"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpenPath(null)}
                  >
                    <Icon
                      size={22}
                      weight={active ? "fill" : "regular"}
                      aria-hidden="true"
                    />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <Link href="/account" className="admin-nav-link">
            <UserCircle size={22} aria-hidden="true" />
            بيانات حسابي
          </Link>
          <Link href="/" className="admin-nav-link">
            <ArrowSquareOut size={22} aria-hidden="true" />
            عرض المنصة
          </Link>
          <LogoutButton />
        </div>
      </aside>
      <div className="admin-content" id="admin-content" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
