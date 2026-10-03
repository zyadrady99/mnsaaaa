"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  ClipboardText,
  House,
  UserCircle,
  Users,
} from "@phosphor-icons/react";

const destinations = [
  { href: "/", label: "الرئيسية", icon: House },
  { href: "/teachers", label: "المدرسون", icon: Users },
  { href: "/my-courses", label: "كورساتي", icon: BookOpen },
  { href: "/assessments", label: "التقييمات", icon: ClipboardText },
  { href: "/account", label: "حسابي", icon: UserCircle },
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
            : path === href || path.startsWith(`${href}/`);
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
