import Link from "next/link";
import { BookOpenText } from "@phosphor-icons/react/dist/ssr";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="دروسنا — الرئيسية">
      <span className="brand-mark">
        <BookOpenText size={27} weight="bold" aria-hidden="true" />
      </span>
      <span>
        دروسنا<span className="brand-caption">خطوة بخطوة</span>
      </span>
    </Link>
  );
}
