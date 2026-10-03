import Image from "next/image";
import { BookOpen, UserCircle } from "@phosphor-icons/react/dist/ssr";

export function CatalogImage({
  src,
  kind,
  width,
  height,
  alt = "",
  sizes,
  preload = false,
  compact = false,
}: {
  src: string;
  kind: "course" | "teacher";
  width: number;
  height: number;
  alt?: string;
  sizes?: string;
  preload?: boolean;
  compact?: boolean;
}) {
  const reference = src.trim();
  if (reference) {
    return (
      <Image
        src={reference}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        preload={preload}
        unoptimized={reference.startsWith("/media/images/")}
      />
    );
  }
  const Icon = kind === "teacher" ? UserCircle : BookOpen;
  return (
    <span
      className={`catalog-image-placeholder${compact ? " compact" : ""}`}
      style={compact ? { width, height } : undefined}
      aria-hidden={alt ? undefined : true}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
    >
      <Icon size={compact ? 28 : 60} weight="light" aria-hidden="true" />
      {!compact && (
        <span>{kind === "teacher" ? "صورة المدرس" : "غلاف الكورس"}</span>
      )}
    </span>
  );
}
