import Link from "next/link";
import Form from "next/form";
import { PageHeading } from "@/components/common/page-heading";
import { currentAccount, requestToken } from "@/server/auth/service";
import { database } from "@/server/core/db";
import { referenceData } from "@/server/catalog/queries";
import { standaloneHistory } from "@/server/assessments/service";
import { validUuid } from "@/lib/auth-input";
import { arabicNumber } from "@/lib/catalog";
import { cairoDate } from "@/lib/time";

export const metadata = { title: "الواجبات والامتحانات" };
export default async function StandaloneAssessments({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, account, refs] = await Promise.all([
    searchParams,
    currentAccount(),
    referenceData(),
  ]);
  const grade =
    typeof query.grade === "string"
      ? validUuid(query.grade)
        ? query.grade
        : ""
      : account?.role === "student"
        ? (refs.grades.find((g) => g.slug === account.grade_slug)?.id ?? "")
        : "";
  const subject = validUuid(query.subject) ? query.subject : "";
  const kind =
    query.kind === "homework" || query.kind === "exam" ? query.kind : "";
  const [listed, history] = await Promise.all([
    database().query(
      `select a.id,a.title,a.kind,a.grade_id,g.slug as grade_slug,g.name as grade_name,s.name as subject_name,
      v.duration_seconds,v.max_attempts,v.opens_at,v.closes_at,
      (select count(*)::int from app_private.questions q where q.version_id=v.id) as questions,
      (v.opens_at is null or clock_timestamp()>=v.opens_at) and (v.closes_at is null or clock_timestamp()<v.closes_at) as window_open
      from app_private.assessments a join app_private.assessment_versions v on v.id=a.current_version_id and v.published_at is not null
      join app_private.grades g on g.id=a.grade_id join app_private.subjects s on s.id=a.subject_id
      where a.scope='standalone' and a.status='published' and a.deleted_at is null
        and g.enabled and s.enabled and g.deleted_at is null and s.deleted_at is null
        and ($1::uuid is null or a.grade_id=$1) and ($2::uuid is null or a.subject_id=$2)
        and ($3::text is null or a.kind=$3)
      order by v.published_at desc,a.id limit 100`,
      [grade || null, subject || null, kind || null],
    ),
    account?.role === "student"
      ? standaloneHistory(await requestToken())
      : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeading
        eyebrow="تدريب وتقييم"
        title="الواجبات والامتحانات"
        description="تقييمات مستقلة حسب صفك ومادتك، بدون اشتراك في كورس. حلّها من حساب طالب نشط مسجّل في نفس الصف."
      />
      <Form className="filter-panel" action="/assessments">
        <div className="field">
          <label htmlFor="assessment-grade">الصف الدراسي</label>
          <select id="assessment-grade" name="grade" defaultValue={grade}>
            <option value="">كل الصفوف</option>
            {refs.grades
              .filter((g) => g.enabled)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="assessment-subject">المادة</label>
          <select id="assessment-subject" name="subject" defaultValue={subject}>
            <option value="">كل المواد</option>
            {refs.subjects
              .filter((s) => s.enabled)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="assessment-kind">النوع</label>
          <select id="assessment-kind" name="kind" defaultValue={kind}>
            <option value="">الواجبات والامتحانات</option>
            <option value="homework">الواجبات</option>
            <option value="exam">الامتحانات</option>
          </select>
        </div>
        <button type="submit" className="button primary">
          عرض التقييمات
        </button>
      </Form>
      <section className="page-section" aria-labelledby="available-standalone">
        <h2 id="available-standalone">التقييمات المنشورة</h2>
        <div className="admin-list">
          {listed.rows.map((assessment) => (
            <article className="workspace-panel" key={assessment.id}>
              <div className="admin-list-row">
                <h3>{assessment.title}</h3>
                <span className="chip neutral">
                  {assessment.kind === "homework" ? "واجب" : "امتحان"}
                </span>
              </div>
              <p className="teacher-byline">
                {assessment.subject_name} · {assessment.grade_name}
              </p>
              <p>
                {arabicNumber(assessment.questions)} سؤال
                {assessment.kind === "exam"
                  ? ` · ${arabicNumber(Math.floor(assessment.duration_seconds / 60))} دقيقة · ${arabicNumber(assessment.max_attempts)} محاولة`
                  : " · محاولات غير محدودة"}
              </p>
              {assessment.kind === "exam" && (
                <p className="muted">
                  {assessment.opens_at
                    ? `البداية: ${cairoDate(assessment.opens_at)}`
                    : "بدون بداية موحّدة"}{" "}
                  ·{" "}
                  {assessment.closes_at
                    ? `النهاية: ${cairoDate(assessment.closes_at)}`
                    : "بدون نهاية موحّدة"}
                </p>
              )}
              {account?.role === "student" &&
                account.grade_slug !== assessment.grade_slug && (
                  <p className="field-hint">
                    الحل متاح لطلاب {assessment.grade_name}. راجع الصف المسجّل
                    في حسابك.
                  </p>
                )}
              {!account && (
                <p className="field-hint">
                  سجّل دخولك بحساب طالب من هذا الصف لبدء الحل.
                </p>
              )}
              {!assessment.window_open && (
                <p className="field-hint">
                  الامتحان خارج فترة البدء حاليًا؛ التعليمات والنتائج السابقة
                  تظل متاحة.
                </p>
              )}
              <Link
                href={`/assessments/${assessment.id}`}
                className="button secondary"
              >
                عرض التعليمات
              </Link>
            </article>
          ))}
        </div>
        {!listed.rows.length && (
          <p className="muted">لسه مفيش تقييمات منشورة بالاختيارات دي.</p>
        )}
      </section>
      {account?.role === "student" && (
        <section className="page-section" aria-labelledby="standalone-history">
          <h2 id="standalone-history">محاولاتي ونتائجي</h2>
          <p className="muted">
            آخر ٥٠ محاولة مستقلة. نتائجك محفوظة حتى لو توقف التقييم عن استقبال
            محاولات جديدة.
          </p>
          <div className="admin-list">
            {history.map((attempt) => (
              <article className="workspace-panel" key={attempt.id}>
                <div className="admin-list-row">
                  <h3>{attempt.title}</h3>
                  <span className="chip neutral">
                    {attempt.kind === "homework" ? "واجب" : "امتحان"} · المحاولة{" "}
                    {arabicNumber(attempt.attempt_number)}
                  </span>
                </div>
                <p className="muted">
                  {attempt.subject_name} · {attempt.grade_name} ·{" "}
                  {cairoDate(attempt.submitted_at ?? attempt.started_at)}
                </p>
                {attempt.status === "submitted" ? (
                  <p>
                    {arabicNumber(Number(attempt.earned_points))} /{" "}
                    {arabicNumber(Number(attempt.possible_points))} ·{" "}
                    {attempt.passed ? "ناجح" : "يحتاج تدريب"}
                  </p>
                ) : (
                  <p>
                    المحاولة جارية
                    {attempt.deadline_at
                      ? ` · تنتهي ${cairoDate(attempt.deadline_at)}`
                      : ""}
                    .
                  </p>
                )}
                <Link
                  href={
                    attempt.status === "submitted"
                      ? `/results/${attempt.id}`
                      : `/attempts/${attempt.id}`
                  }
                  className="button secondary"
                >
                  {attempt.status === "submitted"
                    ? "عرض النتيجة"
                    : "كمّل المحاولة"}
                </Link>
              </article>
            ))}
          </div>
          {!history.length && (
            <p className="muted">لسه مبدأتش واجبًا أو امتحانًا مستقلًا.</p>
          )}
        </section>
      )}
    </>
  );
}
