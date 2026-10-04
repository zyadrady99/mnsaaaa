import Link from "next/link";
import { MagnifyingGlass, ArrowLeft } from "@phosphor-icons/react/dist/ssr";

export function EmptyState({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <MagnifyingGlass size={32} aria-hidden="true" />
      </span>
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      <Link className="button secondary" href={href}>
        {action}
        <ArrowLeft size={18} aria-hidden="true" />
      </Link>
    </div>
  );
}
