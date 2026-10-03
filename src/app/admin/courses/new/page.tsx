import { PageHeading } from "@/components/page-heading";
import { CourseEditor } from "@/components/course-editor";
import { requireAccount } from "@/server/auth";
export const metadata = { title: "إضافة كورس" };
export default async function NewCourse() {
  await requireAccount("admin");
  return (
    <>
      <PageHeading
        title="إضافة كورس"
        description="ابدأ ببيانات الكورس، وبعدها جهّز الوحدات والدروس."
      />
      <section className="workspace-panel">
        <CourseEditor />
      </section>
    </>
  );
}
