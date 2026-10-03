"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="empty-state" role="alert">
      <h1>الصفحة ما اتحمّلتش</h1>
      <p className="muted">
        جرّب تفتحها تاني. لو المشكلة مستمرة، ارجع للرئيسية.
      </p>
      <div className="button-row">
        <button className="button primary" onClick={reset}>
          حاول تاني
        </button>
        <Link href="/" className="button secondary">
          الرئيسية
        </Link>
      </div>
    </section>
  );
}
