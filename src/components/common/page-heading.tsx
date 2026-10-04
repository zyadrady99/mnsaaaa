import Link from "next/link";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr";

export function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description: string;
}) {
  return (
    <header className="page-heading">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      <p className="muted">{description}</p>
    </header>
  );
}
export function Breadcrumbs({
  items,
}: {
  items: { label: string; href?: string }[];
}) {
  return (
    <nav className="breadcrumbs" aria-label="مسار الصفحة">
      <ol>
        {[{ label: "الرئيسية", href: "/" }, ...items].map((item, i) => (
          <li key={i}>
            {i > 0 && <CaretLeft size={14} aria-hidden="true" />}
            {item.href ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
