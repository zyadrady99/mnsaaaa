# تجربة مخطط F03

مسودة PostgreSQL ومراجعة محلية لـ[تصميم البيانات](../../docs/phase-2/F03-data-model.ar.md) و[عقد المعاملات](../../docs/phase-2/F03-transactions.ar.md). لم تُطبق على قاعدة F01 أو بيئة إنتاج. `schema-draft.sql` يتوقع قاعدة فارغة، وليس migration قابلة لإعادة تطبيقها على بيانات قائمة.

الملفات:

- `schema-draft.sql`: 28 جدولًا، FK/UNIQUE/CHECK، فهارس، triggers للثبات والنشر، مخطط خاص دون سياسات تشغيل.
- `transaction-prototype.mjs`: معاملات اختبار لتفعيل/تجديد/سحب/تمديد/إلغاء. UUID الفاعل يدخل من fixtures، لا من جلسة مستخدم حقيقية.
- `verify-model.mjs`: قيود إيجابية وسلبية وتجارب تزامن محلية؛ يكتب [النتيجة الآلية](../../docs/phase-2/F03-validation-result.json).

يشترط تشغيل stack التجربة المحلي الموجود في `../auth-spike`، مع PostgreSQL على `127.0.0.1:54322`؛ يعتمد على `pg` وCLI المثبتين هناك، ولا يثبت حزم جديدة. عبر Node 22:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'experiments/data-model/verify-model.mjs'
```

يقرأ إعداد localhost في الذاكرة دون طباعة credentials. ينشئ قاعدة `dorosna_f03_<random_uuid_hex>` غير موجودة ويضع marker ملكية، ثم يطبق المسودة ويختبرها. يغلق اتصالاته ويتحقق من الاسم/المالك/marker وعدم وجود جلسات قبل حذف قاعدته وحدها؛ لا يستخدم DROP CASCADE أو DROP FORCE ولا يمس قواعد أخرى أو يوقف Docker. تعداد صفوف Auth/F01 يُقرأ قبل/بعد للتحقق من الحفاظ على fixtures. stdout لا يحتوي كلمات سر أو أكواد كاملة أو UUIDs لطلاب حقيقيين.

النتيجة الحالية 42/42 على PostgreSQL 17.11، مع تنظيف القاعدة المؤقتة. القياسات تقبل زمن الخادم الحقيقي؛ ليست benchmark للحمل. helper التسليم يثبت نتيجة fixture للتأكد من النهاية الذرية، ولا ينفذ مصحح MCQ أو job مؤقت أو API أو واجهة أو اتصال Bunny. لا يُستخدم prototype مباشرة كمداخل منتج.
