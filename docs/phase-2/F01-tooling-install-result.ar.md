# F01 — نتيجة تركيب أدوات التجربة المحلية

تاريخ التنفيذ والفحص: **2026-10-02 بتوقيت القاهرة**.

**الحالة: تركيب الأدوات وفحص اتصال Docker مكتملان. تجربة الحسابات لم تبدأ، وF01 ما زالت مفتوحة.**

نفذت مجموعة التجهيز في [الخطة المراجعة](F01-local-setup-plan.ar.md) بعد موافقة المستخدم «اه نفذ»: تنزيل Docker والتحقق منه، تركيبه للمستخدم الحالي، بدء محرك Linux وفحصه، وتجهيز Supabase CLI في مجلد تجربة منفصل، ثم حفظ هذه النتيجة.

## 1. النتائج الفعلية

| العنصر | نتيجة التنفيذ |
|---|---|
| Docker Desktop | `4.93.0 (240920)`؛ انتهى المثبت بنجاح و`ExitCode = 0`. |
| موضع التركيب | `C:\Users\zyadrady\AppData\Local\Programs\DockerDesktop`؛ تركيب للمستخدم الحالي، backend `wsl-2`، وتعطيل تكامل Windows containers. |
| Docker CLI / Engine | كلاهما `29.8.1`؛ نجح `docker version` في الاتصال بالخادم، وأظهر context `desktop-linux` والخادم `linux/amd64`. |
| Docker Compose | `v5.5.1`؛ نجح أمر عرض الإصدار. |
| المحرك | نجح `docker info`؛ `OSType = linux`، kernel `6.6.87.2-microsoft-standard-WSL2`، وstorage driver `overlay2`. |
| الحاويات والصور | `Containers = 0`، `ContainersRunning = 0`، `Images = 0` وقت الفحص. لم تسحب صور Supabase أو تشغل حاويات تجريبية. |
| توزيعات WSL | `docker-desktop`: `Running` وWSL2؛ `Ubuntu-24.04`: `Stopped` وWSL2 بعد جاهزية المحرك. |
| Supabase CLI | ثبتت نسخة `2.119.0` محليًا، ونجح `--version` وقرئت `--help`. |
| Node / npm للتجربة | استخدمت الأدوات الموجودة: Node `22.19.0` وnpm `10.9.3` من `C:\Program Files\nodejs`. اختيار PATH لهذه الأوامر كان داخل العملية فقط. |
| حزم npm | أضاف التثبيت 8 حزم، ودقق npm في 9 حزم، وأبلغ عن 0 vulnerabilities في ذلك الفحص. |
| مساحة C المتاحة | `43.28 GiB` بعد التجهيز، مقابل نحو `49.28 GiB` قبله. الفرق يشمل التنزيل والتركيب والملفات المؤقتة وبيانات Docker والحزم؛ ليس قياسًا مستقلًا لحجم كل عنصر. |

قيمة `MemTotal` التي أبلغ عنها Docker كانت `7.61 GiB`: هذه الذاكرة المتاحة للمحرك وقت الفحص، وليست قياسًا لاستهلاكه الفعلي أو استهلاك تجربة Supabase.

لم يطلب مسار التثبيت المنفذ تفعيل ميزة Windows أو تغيير BIOS أو إعادة تشغيل الجهاز. لم تنفذ أوامر تفعيل ميزات Windows أو تحديث WSL أو إعادة تشغيل. سجّل المثبت تحذيرًا عن إرسال حدث analytics، لكنه استكمل التركيب بنجاح؛ فحص الاتصال الفعلي بالمحرك نجح أيضًا.

## 2. تحقق ملف Docker

نزل ملف Windows x64 للإصدار المحدد من [الرابط الرسمي للبناء 240920](https://desktop.docker.com/win/main/amd64/240920/Docker%20Desktop%20Installer.exe)، بعد مراجعة [ملاحظات الإصدار](https://docs.docker.com/desktop/release-notes/#4930).

- حجم الملف الفعلي: `627791792` bytes، نحو `598.7 MiB`.
- SHA-256 المحسوبة مطابقة لـ[ملف checksums الرسمي](https://desktop.docker.com/win/main/amd64/240920/checksums.txt):

```text
c139124c9cf71477dc565c3c0ea5a18f90b93d68ebe9aaa848a065960416c0bc
```

- `Get-AuthenticodeSignature`: الحالة `Valid`؛ الجهة الموقعة `Docker Inc`.
- موضع التنزيل: `C:\Users\zyadrady\AppData\Local\Temp\dorosna-docker-4.93.0\DockerDesktopInstaller.exe`؛ الملف خارج المستودع.

معلمات التركيب المنفذة، بعد التحقق:

```text
install --user --backend=wsl-2 --no-windows-containers --quiet --accept-license
```

هذه المعلمات موثقة في [دليل تركيب Docker على Windows](https://docs.docker.com/desktop/setup/install/windows-install/#installer-flags). قبول شروط المثبت كان ضمن خطوة التركيب المعتمدة؛ لم يشتر اشتراك أو يسجل حساب Docker.

## 3. إعداد أول تشغيل وحماية توزيعة Ubuntu القائمة

قبل بدء Docker، ضبطت إعداداته في `C:\Users\zyadrady\AppData\Roaming\Docker\settings-store.json`، وأضيفت القيم ذاتها إلى `install-settings.json` مع الحفاظ على إعداد WSL2 وقبول الرخصة اللذين أنشأهما المثبت. روجعت أسماء مفاتيح الربط من ملفات نسخة Docker المثبتة قبل الكتابة.

بعد التشغيل، طبّع Docker ملف الإعدادات بنفسه إلى `SettingsVersion = 46`، وأعيدت قراءة القيم التالية منه:

```json
{
  "AutoStart": false,
  "EnableIntegrationWithDefaultWslDistro": false,
  "IntegratedWslDistros": [],
  "OpenUIOnStartupDisabled": true,
  "SettingsVersion": 46
}
```

بدأ التطبيق باستخدام عملية مخفية؛ لم تفعل مشاركة Ubuntu، ولم تشغل أوامر داخلها أو تعدل ملفاتها. ظلّت `Stopped` في فحص WSL النهائي. المحرك يعمل حاليًا في توزيعة Docker الخاصة به، ولا توجد حاويات تطبيق تعمل عليه.

موضع ملف الإعدادات موثق في [مرجع إعدادات Docker Desktop](https://docs.docker.com/desktop/settings-and-maintenance/settings/)، واستقلال توزيعة المحرك وتكامل توزيعات المستخدم موضحان في [مرجع WSL backend](https://docs.docker.com/desktop/features/wsl/).

## 4. ملفات التجربة وفحوصها

أنشئت هذه الملفات فقط داخل مجلد التجربة:

| الملف | الغرض |
|---|---|
| [package.json](../../experiments/auth-spike/package.json) | حزمة خاصة بالتجربة واعتماد تطوير دقيق: `supabase: 2.119.0`. |
| [package-lock.json](../../experiments/auth-spike/package-lock.json) | تثبيت نسخ الاعتمادات والتحقق من integrity لحزمة CLI. |
| [.gitignore](../../experiments/auth-spike/.gitignore) | تجاهل `node_modules` وملفات البيئة وملفات Supabase المؤقتة. |

نجح فحص تطابق إصدار الحزمة المباشر والإصدار في lockfile، ونجح فحص تجاهل `node_modules`. ثبتت CLI وفق طريقة اعتماد التطوير في [مرجع Supabase الرسمي](https://supabase.com/docs/guides/local-development/cli/getting-started)، وبالإصدار المحدد في [إصدار CLI الرسمي](https://github.com/supabase/cli/releases/tag/v2.119.0).

تعذر تنزيل المثبت والوصول إلى بعض ملفات التشغيل داخل قيود تنفيذ Codex؛ نجحت إعادة نفس العمليات خارج تلك القيود. كذلك احتاج عرض نسخة CLI ومساعدتها إلى إنشاء حالة مستخدم تحت `C:\Users\zyadrady\.supabase`، فنجح خارج القيود. هذه النتائج لا تدل على فشل الأدوات أو نقص صلاحيات المستخدم على Windows.

لم يشغل `supabase init` أو `supabase start`، ولم ينشأ config أو schema أو مفاتيح تجربة أو قاعدة بيانات. تقرير الفحص الحالي يثبت جاهزية الأدوات فقط. لم يعدل كود منصة أو ملفات Figma أو مستندات المرحلة الأولى، ولم يتغير diff الملفات المتتبعة السابق.

## 5. المجموعة المقترحة التالية — تنتظر موافقة مستقلة

المقترح التالي هو **تجربة المسار الأساسي للهاتف وكلمة السر محليًا** داخل `experiments/auth-spike`:

1. قراءة مساعدة أوامر CLI المطلوبة، وتهيئة المشروع التجريبي، ومراجعة config الفعلي ومنافذه ومواضع أسراره وحدود الوصول المحلي.
2. ضبط Auth للتجربة دون مزود SMS أو SMTP خارجي، ومنع التسجيل العام، ثم سحب الصور وتشغيل الخدمات المحلية اللازمة لـAuth/Postgres. يراجع config والإصدارات قبل التشغيل، ولا تستخدم مشاريع سحابية أو بيانات طالب حقيقية.
3. كتابة وتشغيل اختبار محدود لإنشاء حساب هاتف وكلمة سر من مسار الأدمن، والدخول والخروج والدخول ثانية، وتجربة كلمة سر خاطئة ورقم مكرر ومنع التسجيل العام؛ وحفظ نتائج منقحة دون كلمات سر أو مفاتيح.
4. تدوين ما نجح وما فشل وما بقي من [اختبارات F01](F01-auth-proposal.ar.md). اختبار هذا المسار لا يغلق T01 كاملًا قبل وجود ملف المستخدم ومسار المنصة، ولا يثبت الاستعادة الحضورية أو صلاحيات المنصة أو إبطال الجلسات القديمة.

هذه المجموعة لم تبدأ. بعد نتيجتها تعرض دفعة إثبات مسار المنصة والاستعادة وبقية T01–T12 قبل اعتماد Auth نهائيًا. المشروع الكامل وF02–F05 وربط Bunny والنشر ليست ضمن التجربة المقترحة.
