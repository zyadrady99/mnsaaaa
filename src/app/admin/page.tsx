import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  MagnifyingGlass,
  Plus,
  Ticket,
} from "@phosphor-icons/react/dist/ssr";
import { PageHeading } from "@/components/common/page-heading";
import { requireAccount } from "@/server/auth/service";
import { database } from "@/server/core/db";
import { arabicNumber } from "@/lib/catalog";
import { cairoDate } from "@/lib/time";

type Counts = {
  students: number;
  courses: number;
  teachers: number;
  activations: number;
};
type RecentCourse = {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  teacher_name: string;
  grade_name: string;
  lessons: number;
};
type RecentActivity = {
  id: string;
  action: string;
  actor: string | null;
  occurred_at: string;
};
const statusNames = {
  draft: "مسودة",
  published: "منشور",
  archived: "مؤرشف",
};
const activityNames: Record<string, string> = {
  register: "إنشاء حساب",
  "teacher-save": "حفظ بيانات مدرس",
  "course-save": "حفظ بيانات كورس",
  "unit-save": "حفظ وحدة",
  "lesson-save": "حفظ درس",
  "lesson-delete": "حذف مسودة درس",
  "unit-delete": "حذف وحدة فارغة",
  "video-fixture": "تجهيز فيديو تجريبي",
  "lesson-publish": "نشر درس",
  "course-publish": "نشر كورس",
  "course-archive": "أرشفة كورس",
  "assessment-save": "حفظ إصدار تقييم",
  "assessment-publish": "نشر إصدار تقييم",
  "codes-generate": "إصدار دفعة أكواد",
  codes_export: "تنزيل دفعة أكواد",
  "code-export": "تنزيل دفعة أكواد",
  "code-cancel": "إلغاء كود غير مستخدم",
  "code-activate": "تفعيل كود",
  "student-disable": "تعطيل حساب طالب",
  "student-enable": "تنشيط حساب طالب",
  "student-update": "تعديل بيانات طالب",
  "access-extend": "تمديد وصول طالب",
  "access-withdraw": "سحب وصول كورس",
  "lesson-override": "فتح درس استثنائي",
  "reference-save": "تعديل صف أو مادة",
  "subject-create": "إضافة مادة",
  "image-upload": "رفع صورة",
  "assessment-archive": "أرشفة تقييم",
};
function activityName(action: string) {
  if (activityNames[action]) return activityNames[action];
  if (action.endsWith("-delete")) return "حذف عنصر";
  if (action.endsWith("-restore")) return "استرجاع عنصر محذوف";
  if (action.startsWith("recovery-"))
    return action.endsWith("complete")
      ? "اكتمال استعادة حساب"
      : "إجراء استعادة حساب";
  if (action.startsWith("registration-reconcile")) return "مراجعة تسجيل حساب";
  return "إجراء على المنصة";
}

export const metadata = { title: "لوحة الإدارة" };
export default async function AdminPage() {
  const account = await requireAccount("admin");
  const [countResult, courseResult, activityResult] = await Promise.all([
    database().query<Counts>(`select
      (select count(*)::int from app_private.accounts where role='student') as students,
      (select count(*)::int from app_private.courses where status='published' and deleted_at is null) as courses,
      (select count(*)::int from app_private.teachers where enabled and deleted_at is null) as teachers,
      (select count(*)::int from app_private.activations) as activations`),
    database().query<RecentCourse>(`select c.id,c.title,c.status,
      t.name as teacher_name,g.name as grade_name,
      (select count(*)::int from app_private.lessons l where l.course_id=c.id) as lessons
      from app_private.courses c
      join app_private.teachers t on t.id=c.teacher_id
      join app_private.grades g on g.id=c.grade_id
      left join lateral (
        select e.occurred_at from app_private.audit_events e
        where e.target_type='course' and e.target_id=c.id
        order by e.occurred_at desc limit 1
      ) activity on true
      where c.deleted_at is null
      order by coalesce(activity.occurred_at,c.archived_at,c.published_at) desc nulls last,c.title,c.id
      limit 5`),
    database().query<RecentActivity>(`select e.id,e.action,e.occurred_at,
      a.full_name as actor from app_private.audit_events e
      left join app_private.accounts a on a.id=e.actor_id
      order by e.occurred_at desc,e.id limit 5`),
  ]);
  const counts = countResult.rows[0];
  return (
    <>
      <div className="admin-overview-heading">
        <PageHeading
          eyebrow="نظرة عامة"
          title={`أهلًا، ${account.full_name}`}
          description="جهّز محتواك، تابع الطلاب، وأصدر أكواد الاشتراك."
        />
        <Link href="/admin/courses/new" className="button primary">
          <Plus size={19} aria-hidden="true" />
          إضافة كورس
        </Link>
      </div>
      <div className="stats-grid" aria-label="إحصاءات المنصة">
        {[
          ["إجمالي الطلاب", counts.students],
          ["الكورسات المنشورة", counts.courses],
          ["المدرسون الظاهرون", counts.teachers],
          ["إجمالي التفعيلات", counts.activations],
        ].map(([label, value]) => (
          <div className="workspace-panel admin-stat-card" key={label}>
            <p className="muted">{label}</p>
            <strong className="stat-value">
              {arabicNumber(Number(value))}
            </strong>
          </div>
        ))}
      </div>
      <nav className="admin-quick-actions" aria-label="إجراءات سريعة">
        <Link href="/admin/courses/new" className="admin-quick-action">
          <span className="admin-quick-icon">
            <BookOpen size={23} aria-hidden="true" />
          </span>
          <span>
            <strong>جهّز كورس جديد</strong>
            <span className="muted">ابدأ بمسودة، وانشرها بعد المراجعة</span>
          </span>
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <Link href="/admin/codes" className="admin-quick-action">
          <span className="admin-quick-icon">
            <Ticket size={23} aria-hidden="true" />
          </span>
          <span>
            <strong>أصدر أكواد اشتراك</strong>
            <span className="muted">
              دفعة لكورس منشور لمدة ٣٠ أو ٦٠ أو ٩٠ يومًا
            </span>
          </span>
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <Link href="/admin/students" className="admin-quick-action">
          <span className="admin-quick-icon">
            <MagnifyingGlass size={23} aria-hidden="true" />
          </span>
          <span>
            <strong>تابع حساب طالب</strong>
            <span className="muted">ابحث بالاسم أو رقم الموبايل</span>
          </span>
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
      </nav>
      <div className="admin-overview-grid">
        <section
          className="workspace-panel admin-overview-panel"
          aria-labelledby="admin-recent-courses"
        >
          <div className="admin-section-heading">
            <h2 id="admin-recent-courses">آخر الكورسات</h2>
            <Link href="/admin/courses" className="text-link">
              كل الكورسات ←
            </Link>
          </div>
          {courseResult.rows.length ? (
            <div className="admin-table-wrap">
              <table
                className="admin-table"
                aria-labelledby="admin-recent-courses"
              >
                <thead>
                  <tr>
                    <th scope="col">الكورس</th>
                    <th scope="col">المدرس</th>
                    <th scope="col">الحالة</th>
                    <th scope="col">الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {courseResult.rows.map((course) => (
                    <tr key={course.id}>
                      <td data-label="الكورس">
                        <strong className="admin-table-title">
                          {course.title}
                        </strong>
                        <span className="admin-table-secondary">
                          {course.grade_name} · {arabicNumber(course.lessons)}{" "}
                          دروس
                        </span>
                      </td>
                      <td data-label="المدرس">أ. {course.teacher_name}</td>
                      <td data-label="الحالة">
                        <span
                          className="admin-status"
                          data-status={course.status}
                        >
                          {statusNames[course.status]}
                        </span>
                      </td>
                      <td data-label="الإجراء">
                        <Link
                          href={`/admin/courses/${course.id}`}
                          className="text-link admin-table-action"
                          aria-label={`إدارة كورس ${course.title}`}
                        >
                          إدارة الكورس ←
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              لسه مفيش كورسات. ابدأ بإنشاء المسودة الأولى.
            </p>
          )}
        </section>
        <section
          className="workspace-panel admin-overview-panel"
          aria-labelledby="admin-recent-activity"
        >
          <div className="admin-section-heading">
            <h2 id="admin-recent-activity">آخر الإجراءات</h2>
            <Link href="/admin/audit" className="text-link">
              عرض السجل ←
            </Link>
          </div>
          {activityResult.rows.length ? (
            <div className="admin-table-wrap">
              <table
                className="admin-table admin-activity-list"
                aria-labelledby="admin-recent-activity"
              >
                <thead>
                  <tr>
                    <th scope="col">الإجراء</th>
                    <th scope="col">صاحب الإجراء</th>
                    <th scope="col">الوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {activityResult.rows.map((activity) => (
                    <tr key={activity.id}>
                      <td data-label="الإجراء">
                        <strong className="admin-table-title">
                          {activityName(activity.action)}
                        </strong>
                      </td>
                      <td data-label="صاحب الإجراء">
                        {activity.actor ?? "النظام"}
                      </td>
                      <td data-label="الوقت">
                        <time
                          dateTime={new Date(
                            activity.occurred_at,
                          ).toISOString()}
                        >
                          {cairoDate(activity.occurred_at)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">لسه مفيش إجراءات مسجّلة.</p>
          )}
        </section>
      </div>
    </>
  );
}
