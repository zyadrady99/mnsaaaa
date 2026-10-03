# تجربة F01 المحلية — التسجيل والحسابات والاستعادة

هذا المجلد لتجربة Auth محدودة، وليس كود المنصة النهائي. نتيجة الدفعة الأولى: **11 فحصًا ناجحًا، مع حذف الحساب الوهمي وإبطال جلساته**. التفاصيل في [تقرير التجربة](../../docs/phase-2/F01-basic-auth-result.ar.md)، والنتائج المنقحة في [JSON](../../docs/phase-2/F01-basic-auth-results.json).

نتيجة الدفعة الثانية: **12 فحصًا ناجحًا لبوابة الخادم والاستعادة، وأربعة فحوص مستقلة لإبطال جلسات Auth**، مع إزالة خمسة حسابات وهمية وبياناتها ودور الاتصال المؤقت. [تقرير الاستعادة](../../docs/phase-2/F01-recovery-result.ar.md) يوضح الأدلة وحدودها؛ F01 ما زالت مفتوحة.

نتيجة الدفعة الحالية: **12 مجموعة ناجحة للتسجيل والتزامن ومنع التخمين و10 مراحل توقف فعلي للعملية والوصول المباشر**، مع حذف 15 هوية وهمية. [تقرير التسجيل](../../docs/phase-2/F01-registration-result.ar.md) يوضح الحالة المضادة المكتشفة في Auth قبل إضافة قيد بوابة الخادم، والحل المحلي وحدود اعتماده. هذه تجربة جدوى، وليست خادم إنتاج.

## التشغيل على الجهاز الحالي

المتطلبات الموجودة والمختبرة: Windows، Docker Desktop باستخدام WSL2، Node `22.19.0` في `C:\Program Files\nodejs`، وأداة C# الخاصة بـ.NET Framework الموجودة في Windows. Supabase CLI مثبتة محليًا بإصدار دقيق `2.119.0`، مع lockfile.

## إعادة الدفعة الحالية

من PowerShell، داخل هذا المجلد، ابدأ النمط الذي يشغّل PostgREST ويقصر Auth على الخادم:

```powershell
.\scripts\start-local.ps1 -WithDataApi -ServerOnlyAuth
$previousAuthSpikePath = $env:PATH
try {
    $env:PATH = (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin') + ';' + $previousAuthSpikePath
    & '.\node_modules\@supabase\cli-windows-x64\bin\supabase.exe' db query --local --file '.\sql\recovery-prototype.sql' --workdir . --agent no
    & '.\node_modules\@supabase\cli-windows-x64\bin\supabase.exe' db query --local --file '.\sql\registration-prototype.sql' --workdir . --agent no
} finally {
    $env:PATH = $previousAuthSpikePath
}
& 'C:\Program Files\nodejs\node.exe' '.\scripts\auth-registration.mjs'
& 'C:\Program Files\nodejs\node.exe' '.\scripts\verify-registration-state.mjs'
```

طبق ملفي SQL بالترتيب أعلاه، وتأكد من ظهور `DO` دون رسالة فشل في كل واحد؛ خروج CLI صفرًا وحده لا يكفي في هذا الإصدار. الملفان ذريّان وقابلان لإعادة التطبيق، وهما نموذج محلي داخل مجلد التجربة، وليسا migrations المنتج. بعدهما توجد سبعة جداول خاصة وصفّان لإعداد صفوف fixture، بلا أعمدة كلمات سر أو JWT.

النمط الحالي يشغّل Postgres وAuth وKong وPostgREST. API: `http://127.0.0.1:54321`؛ منفذ قاعدة البيانات: `127.0.0.1:54322`. Auth وPostgREST داخليان بلا منافذ منشورة على الجهاز. Studio والبريد المحلي والخدمات الأخرى مقفولة. PostgREST لا يحمل Healthcheck في هذه الصورة؛ يتحقق المشغّل من تشغيله واستجابة HTTP.

إن كان النمط السابق يعمل، أوقف خدمات هذا المشروع بالأمر أدناه قبل تغيير النمط؛ CLI لا تضيف الخدمة المستبعدة إلى stack شغالة تلقائيًا. الخدمات الأربع بالنمط المحمي هي الحالة المتروكة بعد الدفعة الحالية.

يلزم استعمال `start-local.ps1` للتجربة الحالية. عند استعمال `supabase start` مباشرة، CLI `2.119.0` تقفل دخول الهاتف دون مزود SMS، ولم تحصر إعدادات الشبكة وحدها المنافذ على localhost في الفحص المنفذ هنا.

مشغّل التجربة يبني ملف Docker وسيطًا داخل `.local/docker-shim`، ويضعه أول PATH للعملية فقط. يمرر المعاملات والمخرجات مباشرة، ويضبط إنشاء حاويات `dorosna-auth-spike` الأربع فقط: يربط المنافذ صراحةً بـ127.0.0.1 ويضبط `GOTRUE_EXTERNAL_PHONE_ENABLED=true` في Auth، دون مزود SMS أو مفتاحه. يعيد PATH ومتغيرات المشغّل بعد الأمر، ولا يغير البرامج المثبتة. عند `-WithDataApi` يدرج schema الخاصة عمدًا في PostgREST لفحص رفض صلاحياتها عبر HTTP؛ أدوار العميل لا تملك استخدامها، ولا يعد هذا API المنتج.

عند `-ServerOnlyAuth` يحمّل المشغّل إعداد Kong فعليًا عبر `/config`، مع Key Auth وACL على خدمات Auth الأربع. يسمح بمفتاح الخادم فقط، ويختبر رفض الدخول العام `401` وقبول صحة الخادم `200`. JWT المستخدم وحده لا يسمح باستدعاء Auth مباشرة. مكالمات البوابة تستخدم مفتاح الخادم في `apikey`، وتبقي Bearer المستخدم عند الحاجة. هذا قيد على Kong المحلي الذي نمتلكه؛ لا يثبت تطبيقه على Supabase المُدار أو عنوان مشروع يمكن تجاوزه.

الاختبار يرفض API خارج localhost أو منافذ منشورة على عنوان آخر. يقرأ المفاتيح في الذاكرة، وينشئ دور اتصال محدودًا بكلمة سر عشوائية، ثم خوادم HTTP فعلية على منافذ عشوائية محلية وحسابات وهمية. العمال عمليات Node مستقلة، تمرر بياناتهم عبر IPC ولا عبر command line أو stdout. لا كلمات سر أو رموز مستخدمين محفوظة لإعادة الطلب، والنتائج تحتفظ بحالات HTTP والأدلة المنقحة فقط وتحذف معرف المستخدم من مسارات Auth المسجلة.

يستخدم اختبار التخمين مفتاح HMAC واحدًا ونطاقًا ثابتًا لعمليتين مختلفتين ولمرحلة إعادة التشغيل، مع عدادات ذرية في Postgres. بقية الفحوص تعطل limiter صراحةً لعزل العطل المطلوب؛ الوضع الافتراضي للبوابة يرفض البدء دون مفتاح مشترك ونطاق ثابت. الحدود والصفوف وسياسة كلمة السر قيم تجربة، لا قرارات منتج نهائية.

المخرجات الخام من CLI ونسخ إعداد Kong التي قد تحمل مفاتيح محلية وسجلات المشغّل والملف التنفيذي الناتج تحت `.local` متجاهلة في Git. لا تنسخها إلى التقرير أو إلى ملفات متصفح. لا توجد مفاتيح إنتاج في التجربة.

بعد انتهاء الفحص يُغلق العمال وخوادم HTTP وتُحذف بيانات run والحسابات المملوكة له ودور الاتصال. يبقى SQL التجربة والدور المقيد بلا LOGIN وصفوف إعداد fixture. لا تشغل فحص الحالة النهائية أثناء اختبار آخر. النتيجة تحفظ في `docs/phase-2/F01-registration-results.json` والتحقق في `F01-registration-verification.json`؛ يسجل التحقق أعداد البيانات وحالة الخدمات وصلاحيات HTTP ونتيجة advisors، بما فيها تنبيهات INFO إن وجدت.

## إيقاف الخدمات مع الاحتفاظ بالبيانات

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin') + ';' + $env:PATH
.\node_modules\.bin\supabase.cmd stop --workdir (Get-Location).Path --project-id dorosna-auth-spike --agent no
```

الأمر يستهدف هذا المشروع فقط، ويحتفظ بالـvolume. لم تستخدم خيارات حذف البيانات أو إيقاف جميع مشاريع الجهاز.

## فحوص الدفعات السابقة والحالة المضادة

الفحوص الأصلية `auth-basic.mjs` و`probe-provider-revocation.mjs` و`auth-recovery.mjs` تتصل بواجهة Auth العامة، لذا تحتاج نمط baseline دون قيد Kong. أوقف stack الحالية أولًا، ثم شغّل `.\scripts\start-local.ps1` دون الخيارين. هذا يعيد إنشاء Kong بإعداد CLI الأصلي؛ حذف `-ServerOnlyAuth` من أمر start على حاوية قائمة لا يفك قيدها. إعادة الفحوص السابقة اختيار مستقل عن الدفعة الحالية، ولا يلزم لفحص التسجيل بعد نجاحه.

لإعادة الحالة المضادة وحدها في baseline، نفّذ `probe-inflight-auth.mjs` ثم أعد تشغيل النمط المحمي. لا تشغله بعد حماية Kong لتستنتج اختفاء السباق الأصلي: سيُمنع الطلب قبل الوصول إلى Auth، ولن يكون الفحص نفسه. الدليل المحفوظ في `F01-inflight-auth-finding.json` يثبت أن طلبًا سبق التحقق منه نجح في تغيير الهاتف بعد التجميد؛ هو دليل مشكلة في الإعداد السابق، وليس فحص نجاح أمني.

### إعادة تجربة الاستعادة السابقة

المكتبة المضافة للتجربة `pg@8.23.1` مثبتة في lockfile. بعد بدء الخدمات، طبق SQL **التجربة فقط** داخل مجلدها؛ لا تعتمد على خروج CLI وحده، وتأكد من ظهور `DO` دون رسالة فشل:

```powershell
$priorAuthSpikePath = $env:PATH
try {
    $env:PATH = (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin') + ';' + $priorAuthSpikePath
    & '.\node_modules\@supabase\cli-windows-x64\bin\supabase.exe' db query --local --file '.\sql\recovery-prototype.sql' --workdir . --agent no
    & '.\node_modules\@supabase\cli-windows-x64\bin\supabase.exe' db query --local --file '.\sql\registration-prototype.sql' --workdir . --agent no
} finally {
    $env:PATH = $priorAuthSpikePath
}
& 'C:\Program Files\nodejs\node.exe' '.\scripts\probe-provider-revocation.mjs'
& 'C:\Program Files\nodejs\node.exe' '.\scripts\auth-recovery.mjs'
```

SQL جملة ذرية واحدة قابلة لإعادة التطبيق؛ لا migration نهائية. الجداول داخل `auth_spike_private`، بلا وصول لأدوار العميل. الاختبار ينشئ دور اتصال مقيدًا وكلمة سره في الذاكرة، ويشغل خادم HTTP على منفذ عشوائي بـ127.0.0.1 فقط، وينشئ خمسة حسابات وهمية. كل طلب HTTP حقيقي؛ المزود وقاعدة البيانات حقيقيان. فشل تأكيد التغيير يحاكى **بعد نجاح طلب تغيير حقيقي** إلى Auth، دون استبدال المزود بـmock.

بعد الاختبار يغلق خادم Node، ويحذف البيانات والحسابات الخاصة بـrun ودور الاتصال، ويبقي الجداول الفارغة ودور الخدمة بلا LOGIN. فحص الحالة النهائية يؤكد الأعداد صفرًا وحالة Docker والربط المحلي ونتيجة advisors. لا تشغل فحص الحالة النهائية أثناء تشغيل اختبارات أخرى على الجداول نفسها؛ التجربة معدة لتشغيل واحد في المرة.

النتائج تحفظ دون credentials في `docs/phase-2/F01-recovery-results.json` و`F01-provider-revocation-results.json` و`F01-recovery-verification.json`. لا تطبع CLI status الخام أو provider bodies أو تفاصيل assertion قد تحمل رمزًا. لا حاجة لواجهة متصفح لإعادة اختبارات HTTP الحالية.

التفاصيل أعلاه تسجل الدفعة السابقة. بعد تمديد البوابة يجب تطبيق `registration-prototype.sql` بعد ملف الاستعادة كما في الأمر، لوجود الأعمدة وقيود التسوية الجديدة. فحص `verify-recovery-state.mjs` القديم وسجله يصفان خدمات الدفعة السابقة الثلاث ونتيجة advisors الفارغة آنذاك؛ لا تستخدمه للتحقق من التمديد الحالي. أعد النمط المحمي ذي الخدمات الأربع ثم استخدم `verify-registration-state.mjs` للحالة الحالية بأكملها.

لا تثبت هذه التجربة ملكية رقم الموبايل. قبول F01 ينتظر طريقة تشغيل Auth المستهدفة، وHTTPS والمتصفح وسياسة الجلسات والتخمين الإنتاجية، وتسوية حالات إنشاء المزود غير المؤكدة. لم تختبر Storage أو بيانات المنتج أو schema F03. [التقرير الحالي](../../docs/phase-2/F01-registration-result.ar.md) هو مرجع النتيجة والدفعة التالية المقترحة.
