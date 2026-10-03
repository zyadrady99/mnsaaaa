import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeading, Breadcrumbs } from "@/components/page-heading";
import { CourseEditor } from "@/components/course-editor";
import { MutationForm } from "@/components/mutation-form";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
import { validUuid } from "@/lib/auth-input";
import { StatusRefresh } from "@/components/status-refresh";
export const metadata = { title: "إدارة الكورس" };
export default async function CourseAdmin({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccount("admin");
  const { id } = await params;
  if (!validUuid(id)) notFound();
  const course = (
    await database().query("select * from app_private.courses where id=$1", [
      id,
    ])
  ).rows[0];
  if (!course) notFound();
  const [unitResult, lessonResult, assessmentResult] = await Promise.all([
    database().query(
      "select id,title,position from app_private.course_units where course_id=$1 order by position",
      [id],
    ),
    database().query(
      `select l.*,v.state as video_state from app_private.lessons l left join app_private.video_uploads v on v.id=l.current_video_id where l.course_id=$1 order by l.position`,
      [id],
    ),
    database().query(
      "select id,title,kind,lesson_id,unit_id,current_version_id from app_private.assessments where course_id=$1 order by kind,title",
      [id],
    ),
  ]);
  const units = unitResult.rows,
    lessons = lessonResult.rows,
    assessments = assessmentResult.rows;
  const unitOptions = units.map((u) => ({ value: u.id, label: u.title }));
  return (
    <>
      <StatusRefresh
        pending={lessons.some((l) => l.video_state === "processing")}
      />
      <Breadcrumbs
        items={[
          { label: "الكورسات", href: "/admin/courses" },
          { label: course.title },
        ]}
      />
      <PageHeading
        title={course.title}
        description={
          course.status === "draft"
            ? "مسودة: جهّز الفيديو والواجب، وانشر الدروس بالترتيب، وبعدها انشر الكورس."
            : course.status === "published"
              ? "كورس منشور: بياناته الأساسية وترتيب الدروس المستخدمة ثابتة."
              : "كورس مؤرشف؛ الطلاب أصحاب الوصول السابق يقدروا يكملوا لحد نهاية مدتهم."
        }
      />
      <div className="button-row">
        {course.status === "published" && (
          <Link href={`/courses/${course.slug}`} className="button secondary">
            عرض صفحة الكورس
          </Link>
        )}
        <Link
          href={`/admin/assessments/new?course=${id}&kind=exam`}
          className="button secondary"
        >
          إضافة امتحان
        </Link>
      </div>
      <div className="editor-columns page-section">
        <details className="workspace-panel editor-details">
          <summary>بيانات الكورس</summary>
          <CourseEditor course={course} />
        </details>
        <section className="workspace-panel">
          <h2>حالة الكورس</h2>
          <p className="muted">
            {course.status === "draft"
              ? "المسودة لا تظهر للطلاب. النشر يحتاج درسًا جاهزًا واحدًا على الأقل."
              : course.status === "published"
                ? "الأرشفة توقف التصفح والتفعيل الجديد، وتحفظ الوصول السابق."
                : "الكورس مؤرشف."}
          </p>
          {course.status !== "archived" && (
            <MutationForm
              endpoint={`/api/admin/course-${course.status === "draft" ? "publish" : "archive"}`}
              body={{ id }}
              fields={[]}
              label={
                course.status === "draft" ? "نشر الكورس محليًا" : "أرشفة الكورس"
              }
              confirmMessage={
                course.status === "published"
                  ? "أرشفة الكورس توقف ظهوره والتفعيل الجديد، وتحفظ وصول الطلاب السابق. تأكيد الأرشفة؟"
                  : undefined
              }
            />
          )}
        </section>
      </div>
      <section className="page-section">
        <div className="section-heading">
          <h2>الوحدات والدروس</h2>
          <span className="muted">{lessons.length} دروس</span>
        </div>
        {course.status !== "archived" && (
          <details className="workspace-panel editor-details">
            <summary>إضافة وحدة</summary>
            <MutationForm
              endpoint="/api/admin/unit-save"
              body={{ courseId: id }}
              fields={[{ name: "title", label: "اسم الوحدة", required: true }]}
              label="إضافة الوحدة"
            />
          </details>
        )}
        <div className="admin-list">
          {units.map((unit) => (
            <section className="workspace-panel" key={unit.id}>
              <h3>{unit.title}</h3>
              {course.status !== "archived" && (
                <details className="editor-details">
                  <summary>تعديل الوحدة</summary>
                  <MutationForm
                    endpoint="/api/admin/unit-save"
                    body={{ id: unit.id, courseId: id }}
                    fields={[
                      {
                        name: "title",
                        label: "اسم الوحدة",
                        value: unit.title,
                        required: true,
                      },
                    ]}
                  />
                  {!lessons.some((l) => l.unit_id === unit.id) &&
                    !assessments.some((a) => a.unit_id === unit.id) && (
                      <MutationForm
                        endpoint="/api/admin/unit-delete"
                        body={{ id: unit.id }}
                        fields={[]}
                        label="حذف الوحدة الفارغة"
                        confirmMessage="حذف الوحدة الفارغة؟"
                      />
                    )}
                </details>
              )}
              <div className="lesson-editor-list page-section">
                {lessons
                  .filter((l) => l.unit_id === unit.id)
                  .map((lesson) => {
                    const homework = assessments.find(
                      (a) => a.kind === "homework" && a.lesson_id === lesson.id,
                    );
                    return (
                      <details className="editor-details" key={lesson.id}>
                        <summary>
                          <strong>
                            {lesson.position}. {lesson.title}
                          </strong>
                          <span className="chip neutral">
                            {lesson.published_at ? "منشور" : "مسودة"}
                          </span>
                        </summary>
                        <MutationForm
                          endpoint="/api/admin/lesson-save"
                          body={{ id: lesson.id, courseId: id }}
                          label="حفظ بيانات الدرس"
                          fields={[
                            {
                              name: "title",
                              label: "عنوان الدرس",
                              value: lesson.title,
                              required: true,
                            },
                            {
                              name: "unitId",
                              label: "الوحدة",
                              type: "select",
                              options: unitOptions,
                              value: lesson.unit_id,
                              required: true,
                              disabled: Boolean(
                                lesson.published_at || lesson.first_used_at,
                              ),
                            },
                            {
                              name: "description",
                              label: "وصف الدرس",
                              type: "textarea",
                              value: lesson.description,
                            },
                            {
                              name: "minutes",
                              label: "مدة الدرس المعروضة بالدقائق",
                              type: "number",
                              min: 1,
                              max: 600,
                              value: lesson.minutes,
                              required: true,
                            },
                          ]}
                        />
                        <div className="action-stack">
                          {!lesson.published_at &&
                            !lesson.first_used_at &&
                            !lesson.current_video_id &&
                            !homework && (
                              <MutationForm
                                endpoint="/api/admin/lesson-delete"
                                body={{ id: lesson.id }}
                                fields={[]}
                                label="حذف المسودة"
                                confirmMessage="حذف مسودة الدرس؟"
                              />
                            )}
                          <p className="muted">
                            الفيديو:{" "}
                            {lesson.video_state === "ready"
                              ? "جاهز للتجربة المحلية"
                              : lesson.video_state === "processing"
                                ? "جاري المعالجة"
                                : lesson.video_state === "failed"
                                  ? "المعالجة فشلت؛ جرّب تاني"
                                  : "لم يُجهّز"}
                          </p>
                          {!lesson.published_at && (
                            <MutationForm
                              endpoint={
                                lesson.video_state === "failed"
                                  ? "/api/admin/video-retry"
                                  : "/api/admin/video-submit"
                              }
                              body={{ lessonId: lesson.id }}
                              fields={[]}
                              label={
                                lesson.video_state === "failed"
                                  ? "إعادة معالجة الفيديو التجريبي"
                                  : "تجهيز فيديو تجريبي"
                              }
                            />
                          )}
                          {!lesson.published_at && !lesson.first_used_at && (
                            <details className="editor-details">
                              <summary>تجربة فشل المعالجة محليًا</summary>
                              <MutationForm
                                endpoint="/api/admin/video-submit"
                                body={{
                                  lessonId: lesson.id,
                                  simulateFailure: true,
                                }}
                                fields={[]}
                                label="تجربة معالجة فاشلة"
                              />
                            </details>
                          )}
                          <Link
                            className="button secondary"
                            href={
                              homework
                                ? `/admin/assessments/${homework.id}`
                                : `/admin/assessments/new?course=${id}&kind=homework&lesson=${lesson.id}`
                            }
                          >
                            {homework ? "إدارة واجب الدرس" : "إضافة واجب الدرس"}
                          </Link>
                          {!lesson.published_at && (
                            <MutationForm
                              endpoint="/api/admin/lesson-publish"
                              body={{ lessonId: lesson.id }}
                              fields={[]}
                              label="نشر الدرس"
                            />
                          )}
                        </div>
                      </details>
                    );
                  })}
              </div>
              {course.status !== "archived" && (
                <details className="editor-details page-section">
                  <summary>إضافة درس في الوحدة</summary>
                  <MutationForm
                    endpoint="/api/admin/lesson-save"
                    body={{ courseId: id, unitId: unit.id }}
                    fields={[
                      { name: "title", label: "عنوان الدرس", required: true },
                      {
                        name: "description",
                        label: "وصف الدرس",
                        type: "textarea",
                      },
                      {
                        name: "minutes",
                        label: "المدة بالدقائق",
                        type: "number",
                        min: 1,
                        max: 600,
                        value: 20,
                        required: true,
                      },
                    ]}
                    label="إضافة الدرس"
                  />
                </details>
              )}
            </section>
          ))}
        </div>
      </section>
      {assessments.some((a) => a.kind === "exam") && (
        <section className="page-section">
          <h2>الامتحانات</h2>
          <div className="admin-list">
            {assessments
              .filter((a) => a.kind === "exam")
              .map((a) => (
                <Link
                  className="workspace-panel admin-list-row"
                  href={`/admin/assessments/${a.id}`}
                  key={a.id}
                >
                  {a.title}
                  <span className="text-link">إدارة الامتحان ←</span>
                </Link>
              ))}
          </div>
        </section>
      )}
    </>
  );
}
