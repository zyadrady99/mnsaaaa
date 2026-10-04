import Link from "next/link";
import Form from "next/form";
import { PageHeading } from "@/components/common/page-heading";
import { requireAccount } from "@/server/auth/service";
import { database } from "@/server/core/db";
import { arabicNumber } from "@/lib/catalog";
export const metadata = { title: "إدارة الطلاب" };
export default async function StudentsAdmin({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccount("admin");
  const query = await searchParams,
    q = typeof query.q === "string" ? query.q.slice(0, 100).trim() : "";
  const students = (
    await database().query(
      `select a.id,a.full_name,a.phone,a.status,a.provisioning_locked,a.recovery_locked,g.name as grade_name
    from app_private.accounts a join app_private.student_profiles p on p.account_id=a.id join app_private.grades g on g.id=p.grade_id
    where a.role='student' and (a.full_name ilike $1 or a.phone ilike $1) order by a.created_at desc limit 100`,
      [`%${q.replace(/[\\%_]/g, "\\$&")}%`],
    )
  ).rows;
  return (
    <>
      <PageHeading
        title="الطلاب"
        description="تابع الحسابات والوصول والتقدم، وراجع طلبات الدعم."
      />
      <Form
        className="filter-panel admin-search-panel"
        action="/admin/students"
      >
        <div className="field">
          <label htmlFor="student-search">الاسم أو رقم الموبايل</label>
          <input
            id="student-search"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={100}
            placeholder="اكتب اسم الطالب أو رقم الموبايل"
          />
        </div>
        <button type="submit" className="button primary">
          بحث عن طالب
        </button>
        {q && (
          <Link href="/admin/students" className="button secondary">
            مسح البحث
          </Link>
        )}
      </Form>
      <section
        className="workspace-panel page-section"
        aria-labelledby="admin-student-list"
      >
        <div className="admin-section-heading">
          <h2 id="admin-student-list">{q ? "نتائج البحث" : "حسابات الطلاب"}</h2>
          <span className="muted">
            {arabicNumber(students.length)} حساب ظاهر · بحد أقصى ١٠٠
          </span>
        </div>
        {students.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table" aria-labelledby="admin-student-list">
              <thead>
                <tr>
                  <th scope="col">الطالب</th>
                  <th scope="col">رقم الموبايل</th>
                  <th scope="col">الصف الدراسي</th>
                  <th scope="col">حالة الحساب</th>
                  <th scope="col">الإجراء</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td data-label="الطالب">
                      <strong className="admin-table-title">
                        {student.full_name}
                      </strong>
                    </td>
                    <td data-label="رقم الموبايل">
                      <bdi>{student.phone.replace(/^\+20/, "0")}</bdi>
                    </td>
                    <td data-label="الصف الدراسي">{student.grade_name}</td>
                    <td data-label="حالة الحساب">
                      <span
                        className="admin-status"
                        data-status={
                          student.provisioning_locked
                            ? "review"
                            : student.recovery_locked
                              ? "recovery"
                              : student.status
                        }
                      >
                        {student.provisioning_locked
                          ? "تسجيل يحتاج مراجعة"
                          : student.recovery_locked
                            ? "قيد الاستعادة"
                            : student.status === "active"
                              ? "نشط"
                              : "معطّل"}
                      </span>
                    </td>
                    <td data-label="الإجراء">
                      <Link
                        href={`/admin/students/${student.id}`}
                        className="text-link admin-table-action"
                        aria-label={`فتح حساب الطالب ${student.full_name}`}
                      >
                        فتح الحساب ←
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            {q
              ? "مفيش طلاب بالبحث ده. جرّب اسمًا أو رقمًا آخر."
              : "لسه مفيش حسابات طلاب مسجّلة."}
          </p>
        )}
      </section>
    </>
  );
}
