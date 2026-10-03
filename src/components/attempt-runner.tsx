"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
type Question = {
  id: string;
  position: number;
  prompt: string;
  points: string;
  selected_option_id: string | null;
  revision: string;
  options: { id: string; label: string }[];
};
type Answer = { optionId: string | null; revision: number };
type Queue = Record<string, Answer>;
export function AttemptRunner({
  attemptId,
  studentId,
  questions,
  remainingMs,
  kind,
}: {
  attemptId: string;
  studentId: string;
  questions: Question[];
  remainingMs: number | null;
  kind: "homework" | "exam";
}) {
  const router = useRouter(),
    key = `dorosna-draft:${studentId}:${attemptId}`,
    fallback = useRef(""),
    busy = useRef(new Set<string>());
  const [acks, setAcks] = useState<Queue>(() =>
    Object.fromEntries(
      questions.map((q) => [
        q.id,
        { optionId: q.selected_option_id, revision: Number(q.revision) },
      ]),
    ),
  );
  const [error, setError] = useState(""),
    [submitting, setSubmitting] = useState(false),
    [remaining, setRemaining] = useState(
      remainingMs === null ? null : Math.ceil(remainingMs / 1000),
    );
  const readStore = useCallback(() => {
    try {
      return localStorage.getItem(key) ?? fallback.current;
    } catch {
      return fallback.current;
    }
  }, [key]);
  const subscribe = useCallback((callback: () => void) => {
    window.addEventListener("storage", callback);
    window.addEventListener("dorosna-draft-change", callback);
    return () => {
      window.removeEventListener("storage", callback);
      window.removeEventListener("dorosna-draft-change", callback);
    };
  }, []);
  const raw = useSyncExternalStore(subscribe, readStore, () => "");
  const parse = useCallback(
    (value: string): Queue => {
      try {
        const data = JSON.parse(value || "{}");
        if (!data || typeof data !== "object" || Array.isArray(data)) return {};
        return Object.fromEntries(
          questions
            .filter((q) => {
              const a = data[q.id];
              return (
                a &&
                Number.isSafeInteger(a.revision) &&
                a.revision > 0 &&
                a.revision < 1e15 &&
                (a.optionId === null ||
                  q.options.some((o) => o.id === a.optionId))
              );
            })
            .map((q) => [q.id, data[q.id]]),
        );
      } catch {
        return {};
      }
    },
    [questions],
  );
  const queue = useMemo(() => parse(raw), [raw, parse]);
  const writeStore = useCallback(
    (value: Queue) => {
      fallback.current = JSON.stringify(value);
      try {
        localStorage.setItem(key, fallback.current);
      } catch {}
      window.dispatchEvent(new Event("dorosna-draft-change"));
    },
    [key],
  );
  const sync = useCallback(async () => {
    const pending = parse(readStore());
    await Promise.all(
      Object.entries(pending).map(async ([questionId, answer]) => {
        if (busy.current.has(questionId)) return;
        busy.current.add(questionId);
        try {
          const response = await fetch(`/api/attempts/${attemptId}/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              questionId,
              optionId: answer.optionId,
              revision: answer.revision,
            }),
          });
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.message ?? "الإجابة لسه على الجهاز فقط.");
          if (data.submitted) {
            router.replace(data.next);
            return;
          }
          const ack = {
            optionId: data.optionId as string | null,
            revision: Number(data.revision),
          };
          setAcks((old) => ({
            ...old,
            [questionId]:
              (old[questionId]?.revision ?? 0) > ack.revision
                ? old[questionId]
                : ack,
          }));
          const latest = parse(readStore());
          if (latest[questionId]?.revision === answer.revision) {
            delete latest[questionId];
            writeStore(latest);
          }
          if (!data.saved && ack.optionId !== answer.optionId)
            setError(
              "إجابة أحدث اتحفظت من جلسة تانية. المعروض هو اللي محفوظ في السيرفر؛ راجعه قبل التسليم.",
            );
          else if (Object.keys(latest).length === 0) setError("");
        } catch (error) {
          setError(
            error instanceof Error && !(error instanceof TypeError)
              ? error.message
              : "الاتصال انقطع. بعض الإجابات على الجهاز فقط.",
          );
        } finally {
          busy.current.delete(questionId);
        }
      }),
    );
  }, [attemptId, parse, readStore, writeStore, router]);
  useEffect(() => {
    const timer = window.setInterval(() => void sync(), 3000);
    void sync();
    return () => window.clearInterval(timer);
  }, [sync]);
  useEffect(() => {
    if (remainingMs === null) return;
    const started = performance.now();
    const timer = window.setInterval(
      () =>
        setRemaining(
          Math.max(
            0,
            Math.ceil((remainingMs - (performance.now() - started)) / 1000),
          ),
        ),
      500,
    );
    return () => window.clearInterval(timer);
  }, [remainingMs]);
  useEffect(() => {
    if (remaining !== 0) return;
    async function readFinal() {
      try {
        const response = await fetch(`/api/attempts/${attemptId}`, {
          cache: "no-store",
        });
        const result = await response.json();
        if (result.submitted) router.replace(result.next);
      } catch {}
    }
    void readFinal();
    const timer = window.setInterval(() => void readFinal(), 3000);
    return () => window.clearInterval(timer);
  }, [remaining, attemptId, router]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (Object.keys(parse(readStore())).length) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [parse, readStore]);
  function choose(questionId: string, optionId: string) {
    const pending = parse(readStore());
    const revision =
      Math.max(
        acks[questionId]?.revision ?? 0,
        pending[questionId]?.revision ?? 0,
      ) + 1;
    writeStore({ ...pending, [questionId]: { optionId, revision } });
    setError("");
  }
  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await sync();
      if (Object.keys(parse(readStore())).length || busy.current.size)
        throw new Error(
          "استنى تأكيد حفظ كل الإجابات قبل التسليم. الإجابات على الجهاز فقط مش هتتحسب.",
        );
      const response = await fetch(`/api/attempts/${attemptId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      router.replace(result.next);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "تعذر التسليم.");
      setSubmitting(false);
    }
  }
  const pendingCount = Object.keys(queue).length;
  return (
    <div className="attempt-runner">
      <div className="attempt-status" role="status">
        <strong>
          {remaining === null
            ? "واجب بدون مؤقت"
            : `المتبقي: ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}
        </strong>
        <span>
          {pendingCount
            ? `${pendingCount} إجابات على الجهاز فقط`
            : "كل الإجابات المحفوظة متزامنة"}
        </span>
      </div>
      {remaining === 0 && (
        <p className="status-message">
          الوقت انتهى. السيرفر بيسلّم آخر إجابات وصلته؛ الإجابات غير المتزامنة
          مش محسوبة.
        </p>
      )}
      {error && (
        <p className="error-summary" role="alert">
          {error}
        </p>
      )}
      {questions.map((question) => (
        <fieldset
          className="attempt-question workspace-panel"
          key={question.id}
          disabled={submitting || remaining === 0}
        >
          <legend>
            السؤال {question.position} · {Number(question.points)} درجات
          </legend>
          <p className="question-prompt">{question.prompt}</p>
          {question.options.map((option) => (
            <label className="answer-option" key={option.id}>
              <input
                type="radio"
                name={`answer-${question.id}`}
                checked={
                  (queue[question.id] ?? acks[question.id])?.optionId ===
                  option.id
                }
                onChange={() => choose(question.id, option.id)}
              />
              <span>{option.label}</span>
            </label>
          ))}
          <p className="field-hint" role="status">
            {queue[question.id]
              ? "على الجهاز فقط — منتظر تأكيد السيرفر"
              : acks[question.id]?.optionId
                ? "محفوظ في السيرفر"
                : "لم تجب بعد"}
          </p>
        </fieldset>
      ))}
      <p className="muted">
        {kind === "homework"
          ? "الواجب يحتاج إجابة على كل الأسئلة قبل التسليم."
          : "الأسئلة غير المجاب عنها تُحسب بصفر."}
      </p>
      <button
        className="button primary"
        disabled={submitting || remaining === 0}
        onClick={() => void submit()}
      >
        {submitting ? "جاري التسليم…" : "تسليم المحاولة"}
      </button>
    </div>
  );
}
