# تجربة صلاحيات F04

يربط [عقد صلاحيات F04](../../docs/phase-2/F04-permission-contract.ar.md) واجهات الطالب والأدمن بالعمليات المسموحة، مع تحقق محلي على مخطط F03 في قاعدة جديدة منفصلة. لا server HTTP أو JWT/Auth/Bunny adapter فعلي ضمن هذه التجربة.

- `permission-contract.mjs`: 48 عملية ومرجع قرارات/قبول/انتقالات وإسقاطات حقول الرد.
- `authorize.mjs`: قواعد أهلية تستخدم callbacks موثوقة للجلسة والحساب والمورد والساعة؛ وclosure للعامل الداخلي. الوقت يحفظ microseconds.
- `read-permissions-draft.sql`: دور قراءة موجود يستبدل runner اسمه بدل `__READER_ROLE__`؛ 6 سياسات RLS و4 views بـsecurity_invoker، دون DML أو keys أو عمود دور.
- `verify-permissions.mjs`: fixtures لجلسات الطالبين والأدمن، 24 مجموعة تحقق، وكتابة [النتيجة الآلية](../../docs/phase-2/F04-validation-result.json).

يشترط stack F01 المحلي الموجود على `127.0.0.1:54322`. يستخدم pg وSupabase CLI المثبتين في `../auth-spike` دون تثبيت حزم جديدة أو طباعة credentials. من جذر workspace عبر Node 22:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'experiments/permissions/verify-permissions.mjs'
```

ينشئ قاعدة `dorosna_f04_<uuid_hex>` ودور `dorosna_f04_reader_<unique_hex>` جديدين بعلامة ملكية. الدور NOLOGIN/NOBYPASSRLS، وعضويته SET=true/INHERIT=false لمنفذ الاختبار فقط، ولا يمنح إلى anon/authenticated. بعد إغلاق اتصالاته يتحقق runner من الاسم والمالك/العلامة وعدم وجود جلسات، ثم يحذف القاعدة ودورها الجديد فقط. حذف الدور يزيل عضويته الجديدة؛ لا حذف قسري ولا توقف Docker ولا تغيير على قاعدة تجربة الحسابات. تُقارن أعداد صفوف F01/Auth قبل/بعد، ولا تخرج بيانات أشخاص أو رموز جلسة في التقرير.

بعض حالات الاختبار تضبط حالة/جيل fixture مباشرة لإعادة استعماله؛ ليست عمليات إعادة تفعيل أو تخفيض auth_epoch لمنتج. ساعة حد النموذج تتحكم بها fixture مقصودة؛ التنفيذ الفعلي يأخذ ساعة الخادم. مثال title/audit الوحيد يكتب داخل نفس معاملة guard، ولا يجوز استخدام permit انتهت معاملته لتفويض كتابة لاحقة.

`app.actor_id/app.auth_epoch` سياق خادم بعد تحقق جلسة؛ لا يثبتان الهوية وحدهما. guard لا يقبل دورًا أو مصدر provider من body، لكن callbacks نفسها يجب أن تكون server-only وأن تعيد وقائع الموارد من البيانات. أدوات التجربة ليست endpoint يُكشف للمستخدم، ولا يُمنح read role إلى واجهة/اتصال SQL لطالب. تحويلها إلى مشروع ومهاجرات وإسقاطات بقية الوظائف يجري في دفعات البناء اللاحقة.

النتيجة: 24/24، القاعدة والدور حُذفا، وعدد صفوف تجربة F01 مطابق. بيانات الخدمات القائمة وإعدادات Auth المحمية لم تُعدّل.
