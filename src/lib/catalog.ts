// Public development fixtures only. No account, subscription, or answer-key data.
export const grades = [
  { id: "g1", label: "الأول الثانوي" },
  { id: "g2", label: "الثاني الثانوي" },
  { id: "g3", label: "الثالث الثانوي" },
] as const;

export const subjects = [
  { id: "physics", label: "الفيزياء" },
  { id: "chemistry", label: "الكيمياء" },
  { id: "math", label: "الرياضيات" },
  { id: "arabic", label: "اللغة العربية" },
] as const;

export type SubjectId = string;
export type GradeId = (typeof grades)[number]["id"];
export type Teacher = {
  id?: string;
  subjectName?: string;
  gradeNames?: string[];
  courseCount?: number;
  slug: string;
  name: string;
  subject: SubjectId;
  grades: GradeId[];
  portrait: string;
  description: string;
  approach: string[];
};
export type Course = {
  id?: string;
  teacher?: Teacher;
  subjectName?: string;
  gradeName?: string;
  slug: string;
  title: string;
  subtitle: string;
  teacherSlug: string;
  subject: SubjectId;
  grade: GradeId;
  cover: string;
  outcomes: string[];
  units: {
    id?: string;
    title: string;
    lessons: { id?: string; title: string; minutes: number }[];
  }[];
};

export const teachers: Teacher[] = [
  {
    slug: "ahmed-hassan",
    name: "أحمد حسن",
    subject: "physics",
    grades: ["g2", "g3"],
    portrait: "/images/teacher-ahmed.svg",
    description:
      "نفهم الفكرة الأول، ونربط القانون بمثال من الحياة، وبعدها نتدرّب على الأسئلة خطوة بخطوة.",
    approach: [
      "شرح الأفكار من أساسها",
      "أمثلة محلولة وتدريب متدرج",
      "واجب بعد كل درس",
    ],
  },
  {
    slug: "mariam-adel",
    name: "مريم عادل",
    subject: "chemistry",
    grades: ["g1", "g3"],
    portrait: "/images/teacher-mariam.svg",
    description:
      "نرتّب المفاهيم ونبني بينها روابط واضحة، علشان المسائل والمعادلات يبقوا أسهل في الفهم والمراجعة.",
    approach: [
      "تنظيم المفاهيم والمعادلات",
      "تطبيقات على كل جزء",
      "مراجعة تراكمية",
    ],
  },
  {
    slug: "omar-salem",
    name: "عمر سالم",
    subject: "math",
    grades: ["g2", "g3"],
    portrait: "/images/teacher-omar.svg",
    description:
      "كل مسألة ليها نقطة بداية. نتعلّم نختار الطريقة المناسبة، ونحل بخطوات واضحة بدل حفظ الحل.",
    approach: ["تأسيس قبل المسائل", "حل من السهل للأصعب", "تدريب على طرق الحل"],
  },
  {
    slug: "youssef-ali",
    name: "يوسف علي",
    subject: "arabic",
    grades: ["g1", "g3"],
    portrait: "/images/teacher-youssef.svg",
    description:
      "نفهم النص ونستخرج معناه، ونطبّق قواعد اللغة على أمثلة بسيطة وأسئلة متنوعة.",
    approach: [
      "قراءة وفهم قبل الإجابة",
      "تطبيق قواعد النحو",
      "تدريب على أسئلة النصوص",
    ],
  },
];

export const courses: Course[] = [
  {
    slug: "physics-electricity",
    title: "الكهرباء التيارية",
    subtitle: "من الفكرة للدائرة، قانون ورا قانون.",
    teacherSlug: "ahmed-hassan",
    subject: "physics",
    grade: "g3",
    cover: "/images/course-physics.svg",
    outcomes: [
      "تفهم التيار والمقاومة وفرق الجهد",
      "تطبّق قانون أوم على الدوائر",
      "تحل مسائل توصيل المقاومات",
    ],
    units: [
      {
        title: "أساسيات الكهرباء",
        lessons: [
          { title: "التيار الكهربي وفرق الجهد", minutes: 32 },
          { title: "المقاومة وقانون أوم", minutes: 41 },
          { title: "تطبيقات على قانون أوم", minutes: 28 },
        ],
      },
      {
        title: "الدوائر الكهربية",
        lessons: [
          { title: "توصيل المقاومات على التوالي", minutes: 36 },
          { title: "توصيل المقاومات على التوازي", minutes: 38 },
          { title: "حل مسائل الدوائر", minutes: 45 },
        ],
      },
    ],
  },
  {
    slug: "chemistry-elements",
    title: "العناصر الانتقالية",
    subtitle: "اربط الخواص بالتفاعلات، وافهم الصورة كاملة.",
    teacherSlug: "mariam-adel",
    subject: "chemistry",
    grade: "g3",
    cover: "/images/course-chemistry.svg",
    outcomes: [
      "تتعرف على العناصر وخواصها",
      "تفهم تفاعلات الحديد ومركباته",
      "تطبّق على أسئلة الباب الأول",
    ],
    units: [
      {
        title: "فهم العناصر الانتقالية",
        lessons: [
          { title: "مقدمة العناصر الانتقالية", minutes: 30 },
          { title: "التوزيع الإلكتروني والخواص", minutes: 39 },
          { title: "الحديد واستخلاصه", minutes: 42 },
        ],
      },
      {
        title: "التفاعلات والتطبيقات",
        lessons: [
          { title: "مركبات الحديد", minutes: 35 },
          { title: "تدريب شامل على الباب", minutes: 48 },
        ],
      },
    ],
  },
  {
    slug: "math-calculus",
    title: "أساسيات التفاضل",
    subtitle: "خطوات صغيرة، وفهم يوصلّك للحل.",
    teacherSlug: "omar-salem",
    subject: "math",
    grade: "g3",
    cover: "/images/course-math.svg",
    outcomes: [
      "تفهم معنى المشتقة",
      "تستخدم قواعد الاشتقاق",
      "تحل تطبيقات على معدلات التغير",
    ],
    units: [
      {
        title: "مدخل للتفاضل",
        lessons: [
          { title: "فكرة معدل التغير", minutes: 27 },
          { title: "تعريف المشتقة", minutes: 36 },
          { title: "قواعد الاشتقاق", minutes: 43 },
        ],
      },
      {
        title: "تطبيقات",
        lessons: [
          { title: "مشتقة الدوال المركبة", minutes: 40 },
          { title: "تطبيقات ومراجعة", minutes: 46 },
        ],
      },
    ],
  },
  {
    slug: "arabic-reading",
    title: "القراءة والنصوص",
    subtitle: "اقرأ، افهم، وجاوب بثقة.",
    teacherSlug: "youssef-ali",
    subject: "arabic",
    grade: "g3",
    cover: "/images/course-arabic.svg",
    outcomes: [
      "تستخرج الأفكار والمعاني",
      "تحلل الصور والتعبيرات",
      "تتدرّب على أسئلة القراءة",
    ],
    units: [
      {
        title: "فهم النص",
        lessons: [
          { title: "الفكرة الرئيسية والتفاصيل", minutes: 25 },
          { title: "المعاني في السياق", minutes: 31 },
        ],
      },
      {
        title: "تحليل وتطبيق",
        lessons: [
          { title: "الصور والتعبيرات", minutes: 37 },
          { title: "تدريب على نصوص متنوعة", minutes: 44 },
        ],
      },
    ],
  },
  {
    slug: "physics-motion",
    title: "الحركة في خط مستقيم",
    subtitle: "افهم الحركة من الرسم للقانون.",
    teacherSlug: "ahmed-hassan",
    subject: "physics",
    grade: "g2",
    cover: "/images/course-physics.svg",
    outcomes: [
      "تميّز السرعة من العجلة",
      "تقرأ الرسوم البيانية",
      "تحل مسائل الحركة",
    ],
    units: [
      {
        title: "وصف الحركة",
        lessons: [
          { title: "الإزاحة والسرعة", minutes: 29 },
          { title: "العجلة", minutes: 34 },
          { title: "الرسوم البيانية", minutes: 38 },
          { title: "تدريب على الحركة", minutes: 42 },
        ],
      },
    ],
  },
  {
    slug: "chemistry-atom",
    title: "بنية الذرة",
    subtitle: "رحلة لفهم المادة من أصغر تفاصيلها.",
    teacherSlug: "mariam-adel",
    subject: "chemistry",
    grade: "g1",
    cover: "/images/course-chemistry.svg",
    outcomes: [
      "تتعرف على مكونات الذرة",
      "تفهم مستويات الطاقة",
      "تكتب التوزيع الإلكتروني",
    ],
    units: [
      {
        title: "داخل الذرة",
        lessons: [
          { title: "نماذج الذرة", minutes: 31 },
          { title: "مستويات الطاقة", minutes: 35 },
          { title: "التوزيع الإلكتروني", minutes: 40 },
        ],
      },
    ],
  },
  {
    slug: "math-functions",
    title: "الدوال وتمثيلها",
    subtitle: "الرسمة هتخلّي العلاقة أوضح.",
    teacherSlug: "omar-salem",
    subject: "math",
    grade: "g2",
    cover: "/images/course-math.svg",
    outcomes: [
      "تحدد مجال الدالة",
      "تقرأ التمثيل البياني",
      "تفهم تحولات الدوال",
    ],
    units: [
      {
        title: "الدوال",
        lessons: [
          { title: "المجال والمدى", minutes: 33 },
          { title: "التمثيل البياني", minutes: 41 },
          { title: "تحولات الدوال", minutes: 37 },
        ],
      },
    ],
  },
  {
    slug: "arabic-foundations",
    title: "أساسيات النحو",
    subtitle: "افهم موقع الكلمة، ويبان الإعراب.",
    teacherSlug: "youssef-ali",
    subject: "arabic",
    grade: "g1",
    cover: "/images/course-arabic.svg",
    outcomes: [
      "تميّز الجملة الاسمية والفعلية",
      "تحدد الوظائف النحوية",
      "تطبّق الإعراب في السياق",
    ],
    units: [
      {
        title: "بناء الجملة",
        lessons: [
          { title: "الجملة الاسمية", minutes: 28 },
          { title: "الجملة الفعلية", minutes: 32 },
          { title: "تطبيقات على الإعراب", minutes: 39 },
        ],
      },
    ],
  },
];

export function getTeacher(slug: string) {
  return teachers.find((teacher) => teacher.slug === slug);
}
export function getCourse(slug: string) {
  return courses.find((course) => course.slug === slug);
}
export function subjectLabel(id: SubjectId) {
  return subjects.find((subject) => subject.id === id)?.label ?? id;
}
export function gradeLabel(id: GradeId) {
  return grades.find((grade) => grade.id === id)!.label;
}
export function lessonCount(course: Course) {
  return course.units.reduce((count, unit) => count + unit.lessons.length, 0);
}
export function courseMinutes(course: Course) {
  return course.units.reduce(
    (count, unit) =>
      count + unit.lessons.reduce((sum, lesson) => sum + lesson.minutes, 0),
    0,
  );
}
export const arabicNumber = (value: number) =>
  new Intl.NumberFormat("ar-EG").format(value);

export function normalizeSearch(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("ar")
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي");
}

export type CatalogQuery = { q?: string; subject?: string; grade?: string };
export function sanitizeQuery(
  params: Record<string, string | string[] | undefined>,
): CatalogQuery {
  const first = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : value?.[0];
  const q = first(params.q)?.slice(0, 100).trim() || "";
  const subject = subjects.some(
    (subject) => subject.id === first(params.subject),
  )
    ? first(params.subject)
    : "";
  const grade = grades.some((grade) => grade.id === first(params.grade))
    ? first(params.grade)
    : "";
  return { q, subject, grade };
}

export function filterCourses(query: CatalogQuery) {
  const q = normalizeSearch(query.q || "");
  return courses.filter(
    (course) =>
      (!query.subject || course.subject === query.subject) &&
      (!query.grade || course.grade === query.grade) &&
      (!q ||
        normalizeSearch(
          `${course.title} ${subjectLabel(course.subject)} ${getTeacher(course.teacherSlug)!.name}`,
        ).includes(q)),
  );
}
export function filterTeachers(query: CatalogQuery) {
  const q = normalizeSearch(query.q || "");
  return teachers.filter(
    (teacher) =>
      (!query.subject || teacher.subject === query.subject) &&
      (!query.grade || teacher.grades.some((grade) => grade === query.grade)) &&
      (!q ||
        normalizeSearch(
          `${teacher.name} ${subjectLabel(teacher.subject)}`,
        ).includes(q)),
  );
}
