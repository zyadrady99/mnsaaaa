"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Books,
  ClipboardText,
  House,
  Users,
} from "@phosphor-icons/react";

const destinations = [
  { href: "/", label: "الرئيسية", icon: House },
  { href: "/courses", label: "الكورسات", icon: BookOpen },
  { href: "/teachers", label: "المدرسين", icon: Users },
  { href: "/assessments", label: "التقييمات", icon: ClipboardText },
  { href: "/my-courses", label: "كورساتي", icon: Books },
];

export function Navigation({ mobile = false }: { mobile?: boolean }) {
  const path = usePathname();
  return (
    <nav
      className={mobile ? "bottom-nav" : "desktop-nav"}
      aria-label={mobile ? "التنقل الرئيسي على الهاتف" : "التنقل الرئيسي"}
    >
      {destinations.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/"
            ? path === "/"
            : path === href ||
              path.startsWith(`${href}/`) ||
              (href === "/my-courses" && path.startsWith("/learn/"));
        return (
          <Link
            href={href}
            key={href}
            className={`nav-link${active ? " active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon
              size={23}
              weight={active ? "fill" : "regular"}
              aria-hidden="true"
            />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
