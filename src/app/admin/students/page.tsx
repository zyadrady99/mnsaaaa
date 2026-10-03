import Link from "next/link";
import Form from "next/form";
import { PageHeading } from "@/components/page-heading";
import { requireAccount } from "@/server/auth";
import { database } from "@/server/db";
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
      <Form className="filter-panel" action="/admin/students">
        <div className="field">
          <label htmlFor="student-search">الاسم أو رقم الموبايل</label>
          <input
            id="student-search"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={100}
          />
        </div>
        <button className="button primary">بحث</button>
      </Form>
      <div className="admin-list">
        {students.map((student) => (
          <Link
            className="workspace-panel admin-list-row"
            href={`/admin/students/${student.id}`}
            key={student.id}
          >
            <div>
              <h2>{student.full_name}</h2>
              <p className="muted">
                <bdi>{student.phone.replace(/^\+20/, "0")}</bdi> ·{" "}
                {student.grade_name}
              </p>
            </div>
            <span className="chip neutral">
              {student.provisioning_locked
                ? "تسجيل يحتاج مراجعة"
                : student.recovery_locked
                  ? "قيد الاستعادة"
                  : student.status === "active"
                    ? "نشط"
                    : "معطّل"}
            </span>
            <span className="text-link">فتح الحساب ←</span>
          </Link>
        ))}
      </div>
      {!students.length && (
        <p className="muted page-section">مفيش طلاب بالبحث ده.</p>
      )}
    </>
  );
}
