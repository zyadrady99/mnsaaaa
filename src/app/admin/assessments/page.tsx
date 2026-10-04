import Link from "next/link";
import { PageHeading } from "@/components/common/page-heading";
import { requireAccount } from "@/server/auth/service";
import { database } from "@/server/core/db";
import { arabicNumber } from "@/lib/catalog";

export const metadata = { title: "الواجبات والامتحانات المستقلة" };
const statusNames: Record<string, string> = {
  draft: "مسودة",
  published: "منشور",
  archived: "مؤرشف",
};
export default async function AssessmentsAdmin() {
  await requireAccount("admin");
  const assessments = (
    await database().query(`select a.id,a.title,a.kind,a.status,a.deleted_at,
    g.name as grade_name,s.name as subject_name,
    (select count(*)::int from app_private.attempts t where t.assessment_id=a.id) as attempts
    from app_private.assessments a join app_private.grades g on g.id=a.grade_id
    join app_private.subjects s on s.id=a.subject_id where a.scope='standalone'
    order by a.deleted_at nulls first,a.title,a.id`)
  ).rows;
  return (
    <>
      <PageHeading
        title="الواجبات والامتحانات"
        description="تقييمات مستقلة حسب الصف والمادة. تقييمات الكورسات تُدار من داخل الكورس."
      />
      <div className="button-row">
        <Link
          href="/admin/assessments/new?scope=standalone&kind=homework"
          className="button primary"
        >
          إضافة واجب مستقل
        </Link>
        <Link
          href="/admin/assessments/new?scope=standalone&kind=exam"
          className="button secondary"
        >
          إضافة امتحان مستقل
        </Link>
      </div>
      <section
        className="workspace-panel page-section"
        aria-labelledby="standalone-admin-list"
      >
        <div className="admin-section-heading">
          <h2 id="standalone-admin-list">كل التقييمات المستقلة</h2>
          <span className="muted">
            {arabicNumber(assessments.length)} تقييم
          </span>
        </div>
        {assessments.length ? (
          <div className="admin-table-wrap">
            <table
              className="admin-table"
              aria-labelledby="standalone-admin-list"
            >
              <thead>
                <tr>
                  <th scope="col">التقييم</th>
                  <th scope="col">الصف والمادة</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">المحاولات</th>
                  <th scope="col">الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {assessments.map((assessment) => (
                  <tr key={assessment.id}>
                    <td data-label="التقييم">
                      <strong className="admin-table-title">
                        {assessment.title}
                      </strong>
                      <span className="admin-table-secondary">
                        {assessment.kind === "homework" ? "واجب" : "امتحان"}
                      </span>
                    </td>
                    <td data-label="الصف والمادة">
                      {assessment.grade_name} · {assessment.subject_name}
                    </td>
                    <td data-label="الحالة">
                      <span
                        className="admin-status"
                        data-status={
                          assessment.deleted_at ? "archived" : assessment.status
                        }
                      >
                        {assessment.deleted_at
                          ? "محذوف من العرض"
                          : statusNames[assessment.status]}
                      </span>
                    </td>
                    <td data-label="المحاولات">
                      {arabicNumber(assessment.attempts)}
                    </td>
                    <td data-label="الإجراء">
                      <Link
                        href={`/admin/assessments/${assessment.id}`}
                        className="text-link admin-table-action"
                        aria-label={`إدارة ${assessment.title}`}
                      >
                        إدارة التقييم ←
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            لسه مفيش تقييمات مستقلة. ابدأ بواجب أو امتحان جديد.
          </p>
        )}
      </section>
    </>
  );
}
