"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fromCairoInput } from "@/lib/time";
export type EditableQuestion = {
  uid: string;
  prompt: string;
  options: string[];
  correct: number;
  points: number;
  explanation: string;
};
export type AssessmentDraft = {
  id?: string;
  versionId?: string;
  scope?: "course" | "standalone";
  courseId?: string;
  gradeId?: string;
  subjectId?: string;
  kind: "homework" | "exam";
  lessonId?: string;
  unitId?: string;
  title: string;
  durationMinutes: number;
  maxAttempts: number;
  passPercent: number;
  opensAt: string;
  closesAt: string;
  questions: EditableQuestion[];
};
export function AssessmentEditor({
  initial,
  references,
}: {
  initial: AssessmentDraft;
  references?: {
    grades: { id: string; name: string }[];
    subjects: { id: string; name: string }[];
  };
}) {
  const router = useRouter(),
    prefix = useId();
  const [questions, setQuestions] = useState(
    initial.questions.length
      ? initial.questions
      : [
          {
            uid: "first",
            prompt: "",
            options: ["", ""],
            correct: 0,
            points: 1,
            explanation: "",
          },
        ],
  );
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const alert = useRef<HTMLDivElement>(null);
  function update(index: number, changes: Partial<EditableQuestion>) {
    setQuestions((old) =>
      old.map((q, i) => (i === index ? { ...q, ...changes } : q)),
    );
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const body = {
        ...initial,
        scope: initial.scope ?? "course",
        gradeId:
          initial.scope === "standalone"
            ? initial.id
              ? initial.gradeId
              : String(form.get("gradeId"))
            : undefined,
        subjectId:
          initial.scope === "standalone"
            ? initial.id
              ? initial.subjectId
              : String(form.get("subjectId"))
            : undefined,
        title: String(form.get("title")),
        durationMinutes: Number(form.get("duration")),
        maxAttempts: Number(form.get("maxAttempts")),
        passPercent: Number(form.get("passPercent")),
        opensAt: fromCairoInput(String(form.get("opensAt") ?? "")),
        closesAt: fromCairoInput(String(form.get("closesAt") ?? "")),
        questions: questions.map(
          ({ prompt, options, correct, points, explanation }) => ({
            prompt,
            options,
            correct,
            points,
            explanation,
          }),
        ),
      };
      const response = await fetch("/api/admin/assessment-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "تعذر حفظ التقييم.");
      router.push(result.next);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "تعذر الاتصال.");
      requestAnimationFrame(() => alert.current?.focus());
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="mutation-form" onSubmit={save} aria-busy={pending}>
      {error && (
        <div className="error-summary" role="alert" tabIndex={-1} ref={alert}>
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor={`${prefix}-title`}>
          اسم {initial.kind === "homework" ? "الواجب" : "الامتحان"}
        </label>
        <input
          id={`${prefix}-title`}
          name="title"
          required
          maxLength={180}
          defaultValue={initial.title}
        />
      </div>
      {initial.scope === "standalone" && (
        <>
          <div className="editor-columns">
            <div className="field">
              <label htmlFor={`${prefix}-grade`}>الصف الدراسي</label>
              <select
                id={`${prefix}-grade`}
                name="gradeId"
                required
                defaultValue={initial.gradeId ?? ""}
                disabled={pending || Boolean(initial.id)}
              >
                <option value="" disabled>
                  اختار الصف الدراسي
                </option>
                {references?.grades.map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${prefix}-subject`}>المادة</label>
              <select
                id={`${prefix}-subject`}
                name="subjectId"
                required
                defaultValue={initial.subjectId ?? ""}
                disabled={pending || Boolean(initial.id)}
              >
                <option value="" disabled>
                  اختار المادة
                </option>
                {references?.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="field-hint">
            متاح لحسابات الطلاب النشطة من الصف المحدد، بدون كود كورس.{" "}
            {initial.id && "الصف والمادة ثابتان؛ أنشئ مسودة جديدة لتغييرهما."}
          </p>
        </>
      )}
      {initial.kind === "exam" ? (
        <>
          <div className="editor-columns">
            <div className="field">
              <label htmlFor={`${prefix}-duration`}>المدة بالدقائق</label>
              <input
                id={`${prefix}-duration`}
                name="duration"
                type="number"
                min={1}
                max={240}
                defaultValue={initial.durationMinutes}
                required
              />
            </div>
            <div className="field">
              <label htmlFor={`${prefix}-attempts`}>عدد المحاولات</label>
              <input
                id={`${prefix}-attempts`}
                name="maxAttempts"
                type="number"
                min={1}
                max={100}
                defaultValue={initial.maxAttempts}
                required
              />
            </div>
            <div className="field">
              <label htmlFor={`${prefix}-pass`}>نسبة النجاح</label>
              <input
                id={`${prefix}-pass`}
                name="passPercent"
                type="number"
                min={0}
                max={100}
                step="0.001"
                defaultValue={initial.passPercent}
                required
              />
            </div>
          </div>
          <p className="field-hint">
            المواعيد بتوقيت القاهرة. سيبها فارغة لو مفيش موعد موحّد.
          </p>
          <div className="editor-columns">
            <div className="field">
              <label htmlFor={`${prefix}-opens`}>بداية إتاحة الامتحان</label>
              <input
                id={`${prefix}-opens`}
                name="opensAt"
                type="datetime-local"
                defaultValue={initial.opensAt}
              />
            </div>
            <div className="field">
              <label htmlFor={`${prefix}-closes`}>النهاية الموحّدة</label>
              <input
                id={`${prefix}-closes`}
                name="closesAt"
                type="datetime-local"
                defaultValue={initial.closesAt}
              />
            </div>
          </div>
        </>
      ) : (
        <p className="status-message">
          نجاح الواجب من ٧٠٪. المحاولات غير محدودة.
        </p>
      )}
      {questions.map((question, index) => (
        <fieldset
          className="question-editor"
          key={question.uid}
          disabled={pending}
        >
          <legend>السؤال {index + 1}</legend>
          <div className="field">
            <label htmlFor={`${prefix}-${question.uid}-prompt`}>
              نص السؤال
            </label>
            <textarea
              id={`${prefix}-${question.uid}-prompt`}
              value={question.prompt}
              onChange={(event) =>
                update(index, { prompt: event.target.value })
              }
              required
              maxLength={3000}
              rows={3}
            />
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-${question.uid}-points`}>
              درجة السؤال
            </label>
            <input
              id={`${prefix}-${question.uid}-points`}
              type="number"
              min="0.001"
              max="1000"
              step="0.001"
              value={question.points}
              onChange={(event) =>
                update(index, { points: Number(event.target.value) })
              }
              required
            />
          </div>
          <p className="field-hint">حدّد الإجابة الصحيحة بجانب الاختيار.</p>
          {question.options.map((option, i) => (
            <div className="option-editor" key={i}>
              <label className="correct-option">
                <input
                  type="radio"
                  name={`correct-${question.uid}`}
                  checked={question.correct === i}
                  onChange={() => update(index, { correct: i })}
                />
                <span className="sr-only">
                  الاختيار {i + 1} هو الإجابة الصحيحة للسؤال {index + 1}
                </span>
              </label>
              <div className="field">
                <label htmlFor={`${prefix}-${question.uid}-option-${i}`}>
                  الاختيار {i + 1}
                </label>
                <input
                  id={`${prefix}-${question.uid}-option-${i}`}
                  value={option}
                  onChange={(event) =>
                    update(index, {
                      options: question.options.map((v, j) =>
                        j === i ? event.target.value : v,
                      ),
                    })
                  }
                  required
                  maxLength={1000}
                />
              </div>
            </div>
          ))}
          <div className="button-row">
            {question.options.length < 6 && (
              <button
                type="button"
                className="button secondary small"
                onClick={() =>
                  update(index, { options: [...question.options, ""] })
                }
              >
                إضافة اختيار
              </button>
            )}
            {question.options.length > 2 && (
              <button
                type="button"
                className="button danger small"
                onClick={() =>
                  update(index, {
                    options: question.options.slice(0, -1),
                    correct: Math.min(
                      question.correct,
                      question.options.length - 2,
                    ),
                  })
                }
              >
                حذف آخر اختيار
              </button>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${prefix}-${question.uid}-explanation`}>
              شرح الإجابة
            </label>
            <textarea
              id={`${prefix}-${question.uid}-explanation`}
              value={question.explanation}
              onChange={(event) =>
                update(index, { explanation: event.target.value })
              }
              rows={2}
              maxLength={3000}
            />
          </div>
          {questions.length > 1 && (
            <button
              type="button"
              className="button danger small"
              onClick={() =>
                setQuestions((old) => old.filter((_, i) => i !== index))
              }
            >
              حذف السؤال {index + 1}
            </button>
          )}
        </fieldset>
      ))}
      <div className="button-row">
        {questions.length < 100 && (
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={() =>
              setQuestions((old) => [
                ...old,
                {
                  uid: crypto.randomUUID(),
                  prompt: "",
                  options: ["", ""],
                  correct: 0,
                  points: 1,
                  explanation: "",
                },
              ])
            }
          >
            إضافة سؤال
          </button>
        )}
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? "جاري الحفظ…" : "حفظ المسودة"}
        </button>
      </div>
    </form>
  );
}
