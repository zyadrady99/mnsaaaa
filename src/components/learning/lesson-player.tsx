"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
export function LessonPlayer({
  lessonId,
  initialPosition,
  initialRevision,
}: {
  lessonId: string;
  initialPosition: number;
  initialRevision: number;
}) {
  const router = useRouter(),
    video = useRef<HTMLVideoElement>(null),
    revision = useRef(initialRevision),
    lastSaved = useRef(0);
  const [lease, setLease] = useState<{
      generation: string;
      positionSeconds: number;
    } | null>(null),
    [pending, setPending] = useState(false),
    [transfer, setTransfer] = useState(false),
    [message, setMessage] = useState("");
  async function open(move = false) {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/learning/video-open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId, transfer: move }),
      });
      const result = await response.json();
      if (!response.ok) {
        setTransfer(result.error === "watch_in_use");
        throw new Error(result.message);
      }
      setLease(result);
      revision.current = Math.max(
        revision.current,
        Number(result.revision ?? 0),
      );
      setTransfer(false);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "تعذر تشغيل الفيديو.",
      );
    } finally {
      setPending(false);
    }
  }
  async function savePosition(force = false) {
    const player = video.current;
    if (
      !player ||
      !lease ||
      (!force && Math.abs(player.currentTime - lastSaved.current) < 5)
    )
      return;
    lastSaved.current = player.currentTime;
    try {
      const response = await fetch("/api/learning/position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonId,
          generation: lease.generation,
          seconds: player.currentTime,
          revision: ++revision.current,
        }),
        keepalive: true,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      revision.current = Math.max(revision.current, Number(result.revision));
    } catch {
      setMessage(
        "موضع المشاهدة لسه مش محفوظ. اتأكد من الاتصال وأعد تشغيل الفيديو لو المشاهدة اتنقلت.",
      );
    }
  }
  useEffect(() => {
    if (!lease) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch("/api/learning/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lessonId, generation: lease.generation }),
        });
        if (!response.ok) {
          const result = await response.json();
          video.current?.pause();
          setLease(null);
          setMessage(result.message);
        }
      } catch {
        video.current?.pause();
        setMessage("الاتصال انقطع. شغّل الفيديو تاني بعد رجوعه.");
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [lease, lessonId]);
  return (
    <section className="workspace-panel lesson-player" aria-label="مشغل الدرس">
      <p className="field-hint">
        فيديو تجريبي محلي لمدة ٢٠ ثانية، لاختبار تشغيل الدرس وحفظ الموضع.
      </p>
      {lease ? (
        <video
          ref={video}
          controls
          autoPlay
          playsInline
          preload="metadata"
          src={`/api/video/${lessonId}?generation=${lease.generation}`}
          onLoadedMetadata={() => {
            if (video.current)
              video.current.currentTime = Math.min(
                lease.positionSeconds ?? initialPosition,
                Math.max(0, video.current.duration - 0.1),
              );
          }}
          onTimeUpdate={() => void savePosition()}
          onPause={() => void savePosition(true)}
          onEnded={() => void savePosition(true)}
          onError={() => {
            setMessage("الفيديو توقف. راجع الوصول للكورس أو شغّله من جديد.");
            setLease(null);
          }}
        />
      ) : (
        <div className="video-placeholder">
          <span>دروسنا</span>
          <button
            className="button primary"
            disabled={pending}
            onClick={() => void open(transfer)}
          >
            {pending
              ? "جاري التشغيل…"
              : transfer
                ? "نقل المشاهدة هنا"
                : "شغّل الفيديو"}
          </button>
        </div>
      )}
      {message && (
        <p className="status-message" role="status">
          {message}
        </p>
      )}
      {lease && (
        <button
          className="button secondary small"
          onClick={() => {
            video.current?.pause();
            setLease(null);
            void open();
          }}
        >
          إعادة تشغيل المشغل
        </button>
      )}
      <button
        className="button primary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            const response = await fetch("/api/learning/complete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lessonId }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message);
            setMessage(result.message);
            router.refresh();
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : "تعذر حفظ الإكمال.",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        علّم الدرس كمكتمل
      </button>
    </section>
  );
}
