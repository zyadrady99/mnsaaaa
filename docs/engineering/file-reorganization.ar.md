# سجل تنظيم أدوات المشروع — ٣ أكتوبر ٢٠٢٦

نُقلت أدوات التشغيل والتحقق لتكون مجموعات واضحة، مع تحديث أوامر npm والاستيرادات ومراجع التوثيق الحالية. لا تتضمن هذه الدفعة نقل ملفات البيئة أو الوسائط أو قاعدة البيانات أو تعديل migrations أو نشرًا.

## الملفات المنقولة

| المسار السابق                         | المسار الحالي                                      |
| ------------------------------------- | -------------------------------------------------- |
| `scripts/setup-local.mjs`             | `scripts/local/setup-local.mjs`                    |
| `scripts/seed-local.mjs`              | `scripts/local/seed-local.mjs`                     |
| `scripts/create-local-admin.mjs`      | `scripts/local/create-local-admin.mjs`             |
| `scripts/create-local-video.mjs`      | `scripts/local/create-local-video.mjs`             |
| `scripts/prepare-local-demo.mjs`      | `scripts/local/prepare-local-demo.mjs`             |
| `scripts/verify-local-auth.mjs`       | `scripts/verification/verify-local-auth.mjs`       |
| `scripts/verify-local-codes.mjs`      | `scripts/verification/verify-local-codes.mjs`      |
| `scripts/verify-local-learning.mjs`   | `scripts/verification/verify-local-learning.mjs`   |
| `scripts/verify-local-recovery.mjs`   | `scripts/verification/verify-local-recovery.mjs`   |
| `scripts/verify-local-admin.mjs`      | `scripts/verification/verify-local-admin.mjs`      |
| `scripts/verify-local-media.mjs`      | `scripts/verification/verify-local-media.mjs`      |
| `scripts/verify-local-deletion.mjs`   | `scripts/verification/verify-local-deletion.mjs`   |
| `scripts/verify-local-standalone.mjs` | `scripts/verification/verify-local-standalone.mjs` |

## واجهات التشغيل المشتركة

- `scripts/shared/paths.mjs`: جذر المشروع ومسار الملفات محسوبان من موقع الوحدة.
- `scripts/shared/local-stack.mjs`: واجهة وظائف إعداد Supabase المحلي الحالية، مع تسمية واضحة لـ`localStackRoot`.
- `scripts/local/start-local.ps1`: واجهة مشغل Windows الحالي، تمرر الخيارات نفسها دون نقل workdir أو الحاويات.
- `npm run local:start`: تشغيل الخدمات المحلية بخيارات المنتج الحالية.
- `npm run test:features`: فحوص الصور والحذف والتقييمات المستقلة. أمر `test:local` وترتيبه الأصلي محفوظان.
- `npm run format:check`: مراجعة التنسيق دون تعديل الملفات؛ lint يشمل أدوات التشغيل أيضًا.

حُدثت مراجع المسارات في `README.ar.md` و`F06-F12-local-platform.ar.md` و`F15-images-independent-assessments-delete.ar.md` دون استبدال نتائج المراحل السابقة.

## تنظيف الحزم والملفات المولدة

اعتماد `@fontsource-variable/noto-sans-arabic` لا يستورده التطبيق الحالي، الذي يستخدم Cairo محليًا. أُزيل من manifest وlock باستخدام `--package-lock-only --ignore-scripts --offline`، دون تثبيت اعتماد جديد أو تغيير `node_modules`. تراخيص الخطوط محفوظة.

أُضيفت استثناءات ملفات ربط الاستضافة وSupabase المؤقتة. الملف المولد `supabase/.temp/cli-latest` أُزيل من فهرس Git فقط؛ النسخة الموجودة على الجهاز باقية. لا commit أو push ضمن التنظيف.

## حدود الدفعة

المسار `experiments/auth-spike` مستخدم فعلًا بواسطة الأدوات المحلية وDocker؛ الحفاظ عليه يحافظ على البيئة والبيانات القائمة. ملفات `data-model` و`permissions` تجارب مرجعية محفوظة. لا إعادة ضبط للتجارب أو قاعدة البيانات، ولا حذف لملفات AGENTS أو CLAUDE أو مراجع Figma أو تاريخ التوثيق.

فحوص الوظائف التي تكتب بيانات تبقى للمرحلة المشتركة بعد اكتمال تنظيم المصدر وتشغيل الخادم. فحص صياغة الأدوات ومسارات الاستيراد لا يحتاج الاتصال بقاعدة البيانات.

## مراجعة تنظيم الملفات

- فحص الصياغة نجح لملفات JavaScript الخمسة عشر؛ الاستيرادات المحلية الثمانية عشر ومسارات أوامر npm الأربعة عشر موجودة.
- جذر المشروع ومسار بيئة Supabase المحلية يطابقان المسارين السابقين. ملفات البيئة لم تُقرأ في هذا الفحص.
- فحص صياغة واجهة PowerShell نجح دون تشغيلها أو تشغيل Docker.
- `npm run lint` نجح دون تحذيرات، و`npm run typecheck` نجح، و`npm run format:check` نجح.
- `git diff --check` لم يجد أخطاء مسافات. إعداد Windows الحالي قد يحول LF إلى CRLF عند تعامل Git مع الملفات.

هذه مراجعة للنقل والتنظيم وجودة الكود. مراجعة الوظائف المشتركة والبناء تُنفذ بعد اكتمال تجميع التغييرات؛ لا تُحتسب نتائج المرحلة السابقة كتشغيل جديد.
