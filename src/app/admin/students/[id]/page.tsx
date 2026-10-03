import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading } from "@/components/page-heading";
import { MutationForm } from "@/components/mutation-form";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
import { referenceData } from "@/server/catalog";
import { validUuid } from "@/lib/auth-input";
import { cairoDate } from "@/lib/time";
import { RecoveryIssue } from "@/components/recovery-issue";
export const metadata = { title: "حساب الطالب" };
export default async function StudentAdmin({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccount("admin");
  const { id } = await params;
  if (!validUuid(id)) notFound();
  const student = (
    await database().query(
      `select a.id,a.phone,a.full_name,a.status,a.recovery_locked,a.provisioning_locked,p.grade_id from app_private.accounts a join app_private.student_profiles p on p.account_id=a.id where a.id=$1 and a.role='student'`,
      [id],
    )
  ).rows[0];
  if (!student) notFound();
  const [accesses, results, lessons, refs] = await Promise.all([
    database().query(
      `select a.course_id,a.access_until,a.withdrawn_at,c.title,(select count(*)::int from app_private.lesson_progress p join app_private.lessons l on l.id=p.lesson_id where p.student_id=a.student_id and l.course_id=a.course_id and p.completed_at is not null) as completed from app_private.course_access a join app_private.courses c on c.id=a.course_id where a.student_id=$1 order by c.title`,
      [id],
    ),
    database().query(
      `select t.id,t.submitted_at,a.title,r.earned_points,r.possible_points,r.passed from app_private.attempts t join app_private.assessments a on a.id=t.assessment_id join app_private.attempt_results r on r.attempt_id=t.id where t.student_id=$1 order by t.submitted_at desc limit 50`,
      [id],
    ),
    database().query(
      "select l.id,l.title,c.title as course_title from app_private.lessons l join app_private.courses c on c.id=l.course_id where l.published_at is not null order by c.title,l.position",
    ),
    referenceData(),
  ]);
  const locked = student.recovery_locked || student.provisioning_locked;
  return (
    <>
      <PageHeading
        title={student.full_name}
        description={`${student.phone.replace(/^\+20/, "0")} · ${student.status === "active" ? "نشط" : "معطّل"}`}
      />
      <Link href="/admin/students" className="text-link">
        كل الطلاب ←
      </Link>
      <section className="workspace-panel page-section">
        <h2>
          {student.provisioning_locked ? "مراجعة التسجيل" : "استعادة كلمة السر"}
        </h2>
        <p className="muted">
          الاستعادة تتم بعد التحقق من هوية الطالب حضوريًا. تقدم الطالب
          واشتراكاته ونتائجه تفضل محفوظة.
        </p>
        {student.provisioning_locked ? (
          <MutationForm
            endpoint="/api/admin/registration-reconcile"
            body={{ studentId: id }}
            fields={[
              {
                name: "verificationRef",
                label: "مرجع التحقق الحضوري",
                required: true,
                maxLength: 120,
              },
            ]}
            label="مراجعة عملية التسجيل"
          />
        ) : (
          <RecoveryIssue
            studentId={id}
            review={Boolean(student.recovery_locked)}
          />
        )}
      </section>
      {locked ? (
        <p className="status-message">
          الحساب يحتاج إكمال التجهيز أو الاستعادة قبل إجراءات الدعم الأخرى.
        </p>
      ) : (
        <div className="editor-columns page-section">
          <section className="workspace-panel">
            <h2>بيانات الطالب</h2>
            <MutationForm
              endpoint="/api/admin/student-update"
              body={{ studentId: id }}
              fields={[
                {
                  name: "name",
                  label: "الاسم الكامل",
                  value: student.full_name,
                  required: true,
                  maxLength: 120,
                },
                {
                  name: "gradeId",
                  label: "الصف الدراسي",
                  type: "select",
                  options: refs.grades
                    .filter((g) => g.enabled)
                    .map((g) => ({ value: g.id, label: g.name })),
                  value: student.grade_id,
                  required: true,
                },
              ]}
            />
          </section>
          <section className="workspace-panel">
            <h2>
              {student.status === "active"
                ? "تعطيل الحساب"
                : "إعادة تنشيط الحساب"}
            </h2>
            <p className="muted">
              تعطيل الحساب يمنع الدخول والاستخدام ويغلق جلساته، مع حفظ التقدم
              ومدد الاشتراكات.
            </p>
            <MutationForm
              endpoint={`/api/admin/student-${student.status === "active" ? "disable" : "enable"}`}
              body={{ studentId: id }}
              fields={
                student.status === "active"
                  ? [
                      {
                        name: "reason",
                        label: "سبب التعطيل",
                        type: "textarea",
                        required: true,
                        maxLength: 500,
                      },
                    ]
                  : []
              }
              label={
                student.status === "active" ? "تعطيل الحساب" : "تنشيط الحساب"
              }
            />
          </section>
        </div>
      )}
      <section className="page-section">
        <h2>وصول الكورسات</h2>
        <div className="admin-list">
          {accesses.rows.map((access) => (
            <section className="workspace-panel" key={access.course_id}>
              <h3>{access.title}</h3>
              <p className="muted">
                {access.withdrawn_at
                  ? "الوصول مسحوب"
                  : "الوصول حتى " + cairoDate(access.access_until)}{" "}
                · {access.completed} دروس مكتملة
              </p>
              {!locked && !access.withdrawn_at && (
                <div className="editor-columns page-section">
                  <details className="editor-details">
                    <summary>تمديد الوصول</summary>
                    <MutationForm
                      endpoint="/api/admin/access-extend"
                      body={{ studentId: id, courseId: access.course_id }}
                      fields={[
                        {
                          name: "days",
                          label: "الأيام الإضافية",
                          type: "number",
                          min: 1,
                          max: 365,
                          value: 7,
                          required: true,
                        },
                        {
                          name: "reason",
                          label: "سبب التمديد",
                          type: "textarea",
                          required: true,
                          maxLength: 500,
                        },
                      ]}
                      label="تمديد الوصول"
                    />
                  </details>
                  <details className="editor-details">
                    <summary>سحب وصول الكورس</summary>
                    <MutationForm
                      endpoint="/api/admin/access-withdraw"
                      body={{ studentId: id, courseId: access.course_id }}
                      fields={[
                        {
                          name: "reason",
                          label: "سبب السحب",
                          type: "textarea",
                          required: true,
                          maxLength: 500,
                        },
                      ]}
                      label="سحب الوصول"
                    />
                  </details>
                </div>
              )}
            </section>
          ))}
        </div>
        {!accesses.rows.length && (
          <p className="muted">الطالب لسه مفعّلش كورسات.</p>
        )}
      </section>
      {!locked && (
        <details className="workspace-panel editor-details page-section">
          <summary>فتح درس استثنائي للطالب</summary>
          <MutationForm
            endpoint="/api/admin/lesson-override"
            body={{ studentId: id }}
            fields={[
              {
                name: "lessonId",
                label: "الدرس",
                type: "select",
                required: true,
                options: lessons.rows.map((l) => ({
                  value: l.id,
                  label: `${l.course_title} — ${l.title}`,
                })),
              },
              {
                name: "reason",
                label: "سبب الاستثناء",
                type: "textarea",
                required: true,
                maxLength: 500,
              },
            ]}
            label="فتح الدرس"
          />
        </details>
      )}
      <section className="page-section">
        <h2>النتائج الأخيرة</h2>
        <div className="admin-list">
          {results.rows.map((result) => (
            <div className="workspace-panel admin-list-row" key={result.id}>
              <strong>{result.title}</strong>
              <span>
                {result.earned_points} / {result.possible_points} ·{" "}
                {result.passed ? "ناجح" : "يحتاج تدريب"}
              </span>
              <span className="muted">{cairoDate(result.submitted_at)}</span>
            </div>
          ))}
        </div>
        {!results.rows.length && (
          <p className="muted">لسه مفيش محاولات مسلّمة.</p>
        )}
      </section>
    </>
  );
}
