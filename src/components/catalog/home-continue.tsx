import Link from "next/link";
import { ArrowLeft, Ticket } from "@phosphor-icons/react/dist/ssr";
import { CatalogImage } from "@/components/catalog/catalog-image";
import { arabicNumber } from "@/lib/catalog";
import { cairoDate } from "@/lib/time";
import { database } from "@/server/core/db";

type CourseProgress = {
  id: string;
  title: string;
  cover_ref: string | null;
  teacher_name: string;
  grade_name: string;
  access_until: string;
  withdrawn_at: string | null;
  active: boolean;
  total: number;
  completed: number;
};

export async function HomeContinue({ accountId }: { accountId: string }) {
  const course = (
    await database().query<CourseProgress>(
      `select c.id,c.title,c.cover_ref,t.name as teacher_name,g.name as grade_name,
        a.access_until,a.withdrawn_at,
        a.access_until>clock_timestamp() and a.withdrawn_at is null as active,
        (select count(*)::int from app_private.lessons l join app_private.course_units u on u.id=l.unit_id
          where l.course_id=c.id and l.published_at is not null and l.deleted_at is null and u.deleted_at is null) as total,
        (select count(*)::int from app_private.lesson_progress p
          join app_private.lessons l on l.id=p.lesson_id join app_private.course_units u on u.id=l.unit_id
          where p.student_id=a.student_id and l.course_id=c.id and l.published_at is not null
            and l.deleted_at is null and u.deleted_at is null and p.completed_at is not null) as completed
        from app_private.course_access a join app_private.courses c on c.id=a.course_id
          join app_private.teachers t on t.id=c.teacher_id join app_private.grades g on g.id=c.grade_id
        where a.student_id=$1 and c.status in ('published','archived')
        order by (a.access_until>clock_timestamp() and a.withdrawn_at is null) desc,a.started_at desc,c.id
        limit 1`,
      [accountId],
    )
  ).rows[0];

  return (
    <section
      className="continue-section"
      id="continue-section"
      aria-labelledby="continue-title"
    >
      {course ? (
        <div className="continue-panel">
          <div className="continue-art">
            <CatalogImage
              src={course.cover_ref ?? ""}
              kind="course"
              width={640}
              height={360}
              alt=""
              sizes="160px"
            />
          </div>
          <div className="continue-content">
            <p className="section-kicker">
              {course.active
                ? "خطوتك في المذاكرة"
                : course.withdrawn_at
                  ? "الوصول مسحوب · تقدمك محفوظ"
                  : "انتهت المدة · تقدمك محفوظ"}
            </p>
            <h2 id="continue-title">
              {course.active ? "ارجع لـ" : "تقدمك في "}
              {course.title}
            </h2>
            <p className="continue-byline">
              أ. {course.teacher_name} <span>·</span> {course.grade_name}
            </p>
            <div className="progress-label">
              <span>إكمال الدروس</span>
              <strong>
                {arabicNumber(course.completed)} من {arabicNumber(course.total)}{" "}
                دروس مكتملة
              </strong>
            </div>
            <progress
              value={course.completed}
              max={course.total || 1}
              aria-label={`${arabicNumber(course.completed)} من ${arabicNumber(course.total)} دروس مكتملة في ${course.title}`}
            />
            {course.active && (
              <p className="continue-expiry">
                الوصول حتى {cairoDate(course.access_until)}
              </p>
            )}
          </div>
          <div className="continue-actions">
            <Link href={`/learn/${course.id}`} className="button primary">
              {course.active ? "كمّل المذاكرة" : "شوف تقدمك ونتائجك"}
              <ArrowLeft size={20} aria-hidden="true" />
            </Link>
            <Link href="/my-courses#activate" className="text-link">
              معاك كود جديد؟
            </Link>
          </div>
        </div>
      ) : (
        <div className="continue-panel continue-empty">
          <span className="continue-empty-icon" aria-hidden="true">
            <Ticket size={36} />
          </span>
          <div className="continue-content">
            <p className="section-kicker">خطوتك الأولى</p>
            <h2 id="continue-title">معاك كود كورس؟ نبدأ بيه.</h2>
            <p className="section-description">
              لسه مفيش كورسات مفعّلة على حسابك. فعّل كود السنتر، أو اختار كورس
              يناسبك.
            </p>
          </div>
          <div className="continue-actions">
            <Link href="/my-courses#activate" className="button primary">
              فعّل كودك
              <Ticket size={20} aria-hidden="true" />
            </Link>
            <Link href="#discover" className="text-link">
              استكشف الكورسات
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
