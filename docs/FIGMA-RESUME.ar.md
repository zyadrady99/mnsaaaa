# حالة تصميم Figma وطريقة الاستكمال

## الملف

- الاسم: **دروسنا — منصة تعليمية مصرية MVP**
- الرابط: https://www.figma.com/design/pvQSfyIMugJE6vA6KpsQrS
- الفريق: `zyad`
- الخطة: Starter، وتسمح بثلاث صفحات فقط.

## الموجود حاليًا داخل Figma

### الصفحات

1. `00 — System & decisions`
2. `01 — Student experience`
3. `02 — Admin & flows`

سيُنظم النطاق الكامل باستخدام Sections داخل الصفحات الثلاث بدل إنشاء صفحة لكل مجموعة شاشات.

### الأساس المنشأ

- 63 variable محلية موزعة على:
  - Primitives
  - Color
  - Dimensions
  - Typography
- 8 Arabic text styles باستخدام `Noto Sans Arabic`.
- Effect style واحد للـmodal والـbottom sheet.
- Cover frame.
- لوحة قرارات وبدائل للاسم والألوان والكروت والكثافة وصفحة الكورس.
- لوحة ألوان وطباعة مرئية.

## نقطة التوقف

أوقف Figma الاستدعاءات بالرسالة:

> You've reached the Figma MCP tool call limit on the Starter plan.

استدعاء إنشاء المكونات رُفض قبل التنفيذ، لذلك لا توجد مكونات أو شاشات منتج ناقصة جزئيًا تحتاج تنظيفًا.

## ترتيب الاستكمال

1. إنشاء المكونات المحلية المرتبطة بالـtokens:
   - Button
   - Text field
   - Filter chip
   - Teacher card
   - Course card
   - Lesson row
   - MCQ option
   - Progress/status components
   - Student bottom navigation
   - Admin side navigation
   - Data table / mobile entity card
   - Dialog, toast, empty/error/skeleton
2. مراجعة مرئية للأساس والمكونات وإصلاح القص أو التداخل.
3. شاشات الطالب mobile بالترتيب المحدد في مواصفات UX.
4. نسخ responsive الرئيسية وصفحة الكورس والمشغل والامتحان.
5. لوحة الإدارة الأساسية.
6. التدفقات والـannotations ومواصفات handoff.
7. فحص RTL والتباين والـtouch targets والحالات والاستجابة.

## مصادر الحقيقة

- نظام التصميم: `design-system/dorosna-mvp/MASTER.md`
- المواصفات والتدفقات: `docs/UX-MVP-SPEC.ar.md`
- معرفات Figma وحالة التنفيذ: `docs/figma-state-dorosna-mvp.json`
