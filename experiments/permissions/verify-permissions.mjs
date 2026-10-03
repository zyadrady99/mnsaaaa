import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {localSettings} from '../auth-spike/scripts/local-runtime.mjs';
import {transaction} from '../data-model/transaction-prototype.mjs';
import {operations,project} from './permission-contract.mjs';
import {createAuthorizer,createInternalAuthorizer} from './authorize.mjs';
const require=createRequire(new URL('../auth-spike/package.json',import.meta.url));
const {Client,Pool,types}=require('pg');types.setTypeParser(1184,v=>v);
const run=randomUUID().replaceAll('-','');
const dbName=`dorosna_f04_${run}`,reader=`dorosna_f04_reader_${run.slice(0,16)}`,marker=`F04-owned-${run}`;
if(!/^dorosna_f04_[a-f0-9]{32}$/.test(dbName)||!/^dorosna_f04_reader_[a-f0-9]{16}$/.test(reader)) throw new Error('invalid scope');
const report={phase:'F04',scope:'operation guards and own-history SQL read prototype; fixture sessions, no HTTP/provider authentication',date:'2026-10-02',operations:Object.keys(operations).length,checks:[],databaseRemoved:false,roleRemoved:false,baselineCountsUnchanged:false,pass:false};
let root,pool,dbCreated=false,roleCreated=false,baseline,check='setup',clockOverride=null;
const f={},sessions=new Map(),issued=new WeakSet();
const assert=v=>{if(!v) throw Object.assign(new Error('assertion'),{code:'assertion_failed'});};
const safe=e=>/^[a-zA-Z0-9_]{1,60}$/.test(e?.code??'')?e.code:'unclassified_error';
async function test(id,fn){check=id;try{await fn();report.checks.push({id,pass:true});}catch(e){report.checks.push({id,pass:false,code:safe(e)});throw e;}}
async function reject(fn,code){let got;try{await fn();}catch(e){got=e.code;}assert(got===code);}
async function snapshot(){
  const {rows:tables}=await root.query("select tablename from pg_tables where schemaname='auth_spike_private' order by tablename");const counts={};
  for(const {tablename} of tables){assert(/^[a-z_]+$/.test(tablename));counts[tablename]=(await root.query(`select count(*)::integer n from auth_spike_private.${tablename}`)).rows[0].n;}
  counts.authUsers=(await root.query('select count(*)::integer n from auth.users')).rows[0].n;return counts;
}
async function row(c,sql,args=[]){return (await c.query(sql,args)).rows[0];}
async function clock(c){return clockOverride??(await row(c,'select clock_timestamp()::text t')).t;}
async function facts(c,op,actor,input){
  if(op==='catalog.detail') return {courseStatus:(await row(c,'select status from app_private.courses where id=$1',[input.courseId]))?.status};
  if(op==='catalog.list'||['student.profile','student.courses'].includes(op)) return {};
  if(op.startsWith('admin.')){
    const target=input.studentId?await row(c,'select role from app_private.accounts where id=$1',[input.studentId]):null;
    const access=input.studentId?await row(c,'select * from app_private.course_access where student_id=$1 and course_id=$2',[input.studentId,input.courseId]):null;
    if(op==='admin.courseCosmetic') await c.query('select id from app_private.courses where id=$1 for update',[input.courseId]);
    if(op==='admin.lessonDraftEdit'){
      const l=await row(c,'select * from app_private.lessons where id=$1',[input.lessonId]);
      if(!l)return null;
      const used=await row(c,`select exists(select 1 from app_private.lesson_progress where lesson_id=$1)
        or exists(select 1 from app_private.assessments where lesson_id=$1)
        or exists(select 1 from app_private.gate_overrides where lesson_id=$1)
        or exists(select 1 from app_private.watch_leases where lesson_id=$1) as used`,[input.lessonId]);
      return {lessonPublished:!!l.published_at,firstUsed:!!l.first_used_at,hasReferences:used.used};
    }
    return {targetRole:target?.role,access};
  }
  if(op.startsWith('code.')){
    const r=await row(c,`select x.course_id,x.cancelled_at,a.student_id as owner,b.activate_before,co.status
      from app_private.activation_codes x join app_private.code_batches b on b.id=x.batch_id join app_private.courses co on co.id=x.course_id
      left join app_private.activations a on a.code_id=x.id where x.id=$1`,[input.codeId]);
    return r?{courseId:r.course_id,courseStatus:r.status,codeOwnerId:r.owner,codeCancelled:!!r.cancelled_at,activateBefore:r.activate_before}:null;
  }
  if(op==='student.progressHistory'){
    const r=await row(c,'select student_id from app_private.lesson_progress where student_id=$1 and lesson_id=$2',[input.studentId??actor,input.lessonId]);return {ownerId:r?.student_id};
  }
  const attempt=input.attemptId?await row(c,'select * from app_private.attempts where id=$1',[input.attemptId]):null;
  const courseId=attempt?.course_id??input.courseId;
  const course=await row(c,'select status from app_private.courses where id=$1 for share',[courseId]);
  const access=await row(c,'select * from app_private.course_access where student_id=$1 and course_id=$2',[actor,courseId]);
  const lesson=await row(c,'select * from app_private.lessons where id=$1',[input.lessonId??f.lesson]);
  const version=await row(c,'select * from app_private.assessment_versions where id=$1',[attempt?.version_id??input.versionId??f.version]);
  const used=version?await row(c,'select count(*)::integer n from app_private.attempts where student_id=$1 and assessment_id=$2',[actor,version.assessment_id]):null;
  const gate=lesson?await row(c,`select not exists(
    select 1 from app_private.lessons p join app_private.assessments hw on hw.lesson_id=p.id and hw.kind='homework'
    where p.course_id=$2 and p.position=(select max(position) from app_private.lessons where course_id=$2 and published_at is not null and position<$3)
    and not exists(select 1 from app_private.homework_passes h where h.student_id=$1 and h.assessment_id=hw.id)
    and not exists(select 1 from app_private.gate_overrides g where g.student_id=$1 and g.lesson_id=$4)) as open`,[actor,courseId,lesson.position,lesson.id]):null;
  return {ownerId:attempt?.student_id,attempt,access,courseId,lessonId:lesson?.id,lessonCourseId:lesson?.course_id,assessmentCourseId:version?.course_id,courseStatus:course?.status,lessonPublished:!!lesson?.published_at,gateOpen:gate?.open===true,
    assessmentPublished:!!version?.published_at,attemptKind:version?.kind,maxAttempts:version?.max_attempts,attemptsUsed:used?.n,opensAt:version?.opens_at,closesAt:version?.closes_at};
}
async function authorize(c,operation,credential,input){
  const guard=createAuthorizer({resolveSession:async token=>sessions.get(token),
    loadAccount:id=>row(c,'select * from app_private.accounts where id=$1 for update',[id]),
    loadResource:(op,actor,body)=>facts(c,op,actor,body),clock:()=>clock(c)});
  return guard(operation,credential,input);
}
async function request(op,credential,input={}){
  const permit=await transaction(pool,c=>authorize(c,op,credential,input));issued.add(permit);return permit;
}
async function readOwn(permit,sql,args=[]){
  assert(issued.has(permit)&&permit.role==='student');
  return transaction(pool,async c=>{
    await c.query(`set local role ${reader}`);
    const session=sessions.get(f.tokens.get(permit.actorId));
    await c.query("select set_config('app.actor_id',$1,true),set_config('app.auth_epoch',$2,true)",[permit.actorId,String(session.authEpoch)]);
    try{return await c.query(sql,args);}catch(e){e.readKind=sql.match(/app_read\.(my_[a-z]+)/)?.[1];throw e;}
  });
}
async function addVersion(a,kind){
  const v=randomUUID(),q=randomUUID(),o1=randomUUID(),o2=randomUUID();
  await transaction(pool,async c=>{
    await c.query(`insert into app_private.assessment_versions(id,assessment_id,course_id,kind,version_number,duration_seconds,max_attempts,pass_percent,closes_at)
      values($1,$2,$3,$4,1,case when $4='exam' then 1200 else null end,case when $4='exam' then 3 else null end,70,
      case when $4='exam' then clock_timestamp()+interval '1 hour' else null end)`,[v,a,f.course,kind]);
    await c.query("insert into app_private.questions(id,version_id,position,prompt,points) values($1,$2,1,'fixture question',10)",[q,v]);
    await c.query("insert into app_private.question_options(id,version_id,question_id,position,label) values($1,$2,$3,1,'A'),($4,$2,$3,2,'B')",[o1,v,q,o2]);
    await c.query("insert into app_private.answer_keys(version_id,question_id,correct_option_id,explanation) values($1,$2,$3,'fixture explanation')",[v,q,o1]);
    await c.query('update app_private.assessment_versions set published_at=clock_timestamp() where id=$1',[v]);
    await c.query('update app_private.assessments set current_version_id=$2 where id=$1',[a,v]);
  });return v;
}
async function addAttempt(student,assessment,version,kind,number,submitted=false){
  const id=randomUUID();await transaction(pool,async c=>{
    await c.query(`insert into app_private.attempts(id,student_id,assessment_id,version_id,course_id,kind,attempt_number,started_at,deadline_at)
      values($1,$2,$3,$4,$5,$6,$7,clock_timestamp()-interval '10 minutes',case when $6='exam' then clock_timestamp()+interval '10 minutes' else null end)`,[id,student,assessment,version,f.course,kind,number]);
    if(submitted){await c.query('insert into app_private.attempt_results(attempt_id,earned_points,possible_points,passed,graded_at) values($1,10,10,true,clock_timestamp())',[id]);
      await c.query("update app_private.attempts set status='submitted',submitted_at=clock_timestamp(),submission_kind='manual',result_id=id where id=$1",[id]);}
  });return id;
}
async function fixtures(){
  for(const k of ['s1','s2','admin','grade','subject','teacher','course','unit','lesson','second','exam','homework'])f[k]=randomUUID();
  f.tokens=new Map();
  await pool.query("insert into app_private.grades(id,name,sort_order) values($1,'fixture grade',1)",[f.grade]);
  await pool.query("insert into app_private.subjects(id,name) values($1,'fixture subject')",[f.subject]);
  await pool.query("insert into app_private.teachers(id,name) values($1,'fixture teacher')",[f.teacher]);
  for(const [key,role,phone] of [['s1','student','+201000000011'],['s2','student','+201000000012'],['admin','admin','+201000000013']]){
    await pool.query('insert into app_private.accounts(id,phone,full_name,role,provisioning_locked) values($1,$2,$3,$4,false)',[f[key],phone,`fixture ${key}`,role]);
    if(role==='student')await pool.query('insert into app_private.student_profiles(account_id,grade_id) values($1,$2)',[f[key],f.grade]);
    const token=randomBytes(32).toString('hex');sessions.set(token,{accountId:f[key],authEpoch:1});f.tokens.set(f[key],token);
  }
  await pool.query("insert into app_private.courses(id,teacher_id,grade_id,subject_id,title) values($1,$2,$3,$4,'fixture course')",[f.course,f.teacher,f.grade,f.subject]);
  await pool.query("insert into app_private.course_units(id,course_id,title,position) values($1,$2,'unit',1)",[f.unit,f.course]);
  for(const [lesson,position]of [[f.lesson,1],[f.second,2]]){
    await pool.query("insert into app_private.lessons(id,course_id,unit_id,position,title) values($1,$2,$3,$4,'lesson')",[lesson,f.course,f.unit,position]);
    const v=randomUUID();await pool.query("insert into app_private.video_uploads(id,lesson_id,generation,provider,local_fixture_ref,state,verification,duration_seconds) values($1,$2,1,'local','fixture-only','ready','fixture',60)",[v,lesson]);
    await pool.query('update app_private.lessons set current_video_id=$2,published_at=clock_timestamp() where id=$1',[lesson,v]);
  }
  await pool.query("update app_private.courses set status='published',published_at=clock_timestamp() where id=$1",[f.course]);
  await transaction(pool,async c=>{
    const batch=randomUUID();await c.query("insert into app_private.code_batches(id,course_id,duration_days,quantity,created_by,request_id,request_digest,created_at) values($1,$2,30,2,$3,$4,$5,clock_timestamp()-interval '90 days')",[batch,f.course,f.admin,randomUUID(),randomBytes(32)]);
    for(const [student,expired]of [[f.s1,true],[f.s2,false]]){
      const code=randomUUID(),activation=randomUUID(),event=randomUUID();
      const period=await row(c,`select t as starts,t+2592000*interval '1 second' ends from
        (select clock_timestamp()-case when $1 then 2592001*interval '1 second' else interval '1 minute' end t) p`,[expired]);
      await c.query("insert into app_private.activation_codes(id,batch_id,course_id,duration_days,code_digest,export_ciphertext,encryption_key_id,masked_suffix) values($1,$2,$3,30,$4,$5,'fixture-only','TEST')",[code,batch,f.course,randomBytes(32),Buffer.from('fixture bytes')]);
      await c.query('insert into app_private.activations(id,code_id,student_id,course_id,duration_days,access_event_id,activated_at) values($1,$2,$3,$4,30,$5,$6)',[activation,code,student,f.course,event,period.starts]);
      await c.query("insert into app_private.access_events(id,student_id,course_id,epoch,kind,activation_id,actor_id,operation_id,added_days,occurred_at,access_started_at,access_until) values($1,$2,$3,1,'grant',$4,$2,$5,30,$6,$6,$7)",[event,student,f.course,activation,randomUUID(),period.starts,period.ends]);
      await c.query('insert into app_private.course_access(student_id,course_id,epoch,started_at,access_until,last_event_id) values($1,$2,1,$3,$4,$5)',[student,f.course,period.starts,period.ends,event]);
      await c.query('insert into app_private.lesson_progress(student_id,lesson_id,position_seconds) values($1,$2,20)',[student,f.lesson]);
      if(student===f.s1)f.usedCode=code;
    }
  });
  await pool.query("insert into app_private.assessments(id,course_id,kind,title) values($1,$2,'exam','exam')",[f.exam,f.course]);
  await pool.query("insert into app_private.assessments(id,course_id,kind,lesson_id,title) values($1,$2,'homework',$3,'homework')",[f.homework,f.course,f.lesson]);
  f.version=await addVersion(f.exam,'exam');f.hwVersion=await addVersion(f.homework,'homework');
  f.result=await addAttempt(f.s1,f.exam,f.version,'exam',1,true);f.otherResult=await addAttempt(f.s2,f.exam,f.version,'exam',1,true);
  f.ongoing=await addAttempt(f.s1,f.exam,f.version,'exam',2);f.hwAttempt=await addAttempt(f.s1,f.homework,f.hwVersion,'homework',1);
}

try{
  const settings=localSettings();root=new Client({connectionString:settings.DB_URL,connectionTimeoutMillis:5000});await root.connect();baseline=await snapshot();
  assert(!(await root.query('select 1 from pg_database where datname=$1',[dbName])).rowCount);
  assert(!(await root.query('select 1 from pg_roles where rolname=$1',[reader])).rowCount);
  await root.query(`create database ${dbName}`);dbCreated=true;await root.query(`comment on database ${dbName} is '${marker}'`);
  await root.query(`create role ${reader} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`);roleCreated=true;await root.query(`comment on role ${reader} is '${marker}'`);
  // PG17 role creation does not imply SET permission for a non-superuser creator.
  // Membership is confined to this new test role and disappears when it is dropped.
  await root.query(`grant ${reader} to current_user with set true`);
  await root.query(`grant ${reader} to current_user with inherit false`);
  const url=new URL(settings.DB_URL);url.pathname=`/${dbName}`;pool=new Pool({connectionString:url.href,max:4,connectionTimeoutMillis:5000});
  await pool.query(await readFile(new URL('../data-model/schema-draft.sql',import.meta.url),'utf8'));
  await pool.query((await readFile(new URL('./read-permissions-draft.sql',import.meta.url),'utf8')).replaceAll('__READER_ROLE__',reader));
  await fixtures();
  const student=f.tokens.get(f.s1),other=f.tokens.get(f.s2),admin=f.tokens.get(f.admin),learning={courseId:f.course,lessonId:f.lesson};
  await test('C01-contract-covers-34-F02-transitions',async()=>{
    const text=await readFile(new URL('../../docs/phase-2/F02-state-contract.ar.md',import.meta.url),'utf8');
    const expected=new Set(text.match(/\b[A CKEMLV]0[1-7]\b/g)?.map(x=>x.trim())??[]);
    const mapped=new Set(Object.values(operations).flatMap(x=>x.transitions.split('/').filter(Boolean)));
    assert(expected.size===34&&[...expected].every(x=>mapped.has(x)));
  });
  await test('C02-unknown-operation-and-internal-route-denied',async()=>{
    await reject(()=>request('admin.becomeAdmin',student),'operation_denied');await reject(()=>request('internal.autosubmit',student),'operation_denied');
    await reject(()=>request('toString',student),'operation_denied');
  });
  await test('A01-forged-role-and-owner-body-ignored',async()=>{
    await reject(()=>request('admin.courseCosmetic',student,{...learning,role:'admin',actorId:f.admin}),'role_denied');
    const p=await request('student.profile',student,{studentId:f.s2,role:'admin',authEpoch:100});assert(p.scopeStudentId===f.s1&&p.role==='student');
  });
  await test('A02-missing-session-denied',()=>reject(()=>request('student.profile','invalid-fixture-token'),'login_required'));
  await test('A03-live-status-locks-and-epoch-checked',async()=>{
    for(const [column,sql,expected]of [['status',"'disabled'",'account_unavailable'],['recovery_locked','true','account_unavailable'],['provisioning_locked','true','account_unavailable'],['auth_epoch','2','session_expired']]){
      await pool.query(`update app_private.accounts set ${column}=${sql} where id=$1`,[f.s1]);
      await reject(()=>request('result.read',student,{attemptId:f.result}),expected);
      await pool.query(`update app_private.accounts set ${column}=${column==='status'?"'active'":column==='auth_epoch'?'1':'false'} where id=$1`,[f.s1]);
    }
  });
  await test('A04-admin-command-uses-verified-actor-and-only-title',async()=>{
    await transaction(pool,async c=>{
      const input={courseId:f.course,title:'reviewed fixture title',role:'student',teacher_id:randomUUID()};
      const p=await authorize(c,'admin.courseCosmetic',admin,input);
      await c.query('update app_private.courses set title=$2 where id=$1',[input.courseId,input.title]);
      await c.query("insert into app_private.audit_events(actor_id,action,target_type,target_id,operation_id) values($1,'course.cosmetic','course',$2,$3)",[p.actorId,input.courseId,randomUUID()]);
    });
    const r=await row(pool,'select title,teacher_id from app_private.courses where id=$1',[f.course]);assert(r.title==='reviewed fixture title'&&r.teacher_id===f.teacher);
    assert((await row(pool,'select actor_id from app_private.audit_events')).actor_id===f.admin);
  });
  await test('O01-other-student-results-and-progress-denied',async()=>{
    await reject(()=>request('result.read',student,{attemptId:f.otherResult}),'resource_not_found');
    await reject(()=>request('student.progressHistory',student,{studentId:f.s2,lessonId:f.lesson}),'resource_not_found');
  });
  await test('E01-expired-access-history-allowed-content-denied',async()=>{
    await request('result.read',student,{attemptId:f.result});await request('student.progressHistory',student,{lessonId:f.lesson});
    await reject(()=>request('video.open',student,learning),'access_required');await reject(()=>request('attempt.start',student,learning),'access_required');
    await request('assessment.read',other,learning);
  });
  await test('M01-expired-exam-resume-allowed-homework-denied',async()=>{
    await request('attempt.resume',student,{attemptId:f.ongoing});await request('attempt.answer',student,{attemptId:f.ongoing});
    await reject(()=>request('attempt.resume',student,{attemptId:f.hwAttempt}),'access_required');
  });
  await test('M02-withdrawal-does-not-use-expiry-exception',async()=>{
    await pool.query('update app_private.course_access set withdrawn_at=clock_timestamp() where student_id=$1',[f.s1]);
    await reject(()=>request('attempt.answer',student,{attemptId:f.ongoing}),'access_required');await request('result.read',student,{attemptId:f.result});
    await pool.query('update app_private.course_access set withdrawn_at=null where student_id=$1',[f.s1]);
  });
  await test('M03-model-hidden-until-close-at-microsecond-boundary',async()=>{
    const close=(await row(pool,'select closes_at from app_private.assessment_versions where id=$1',[f.version])).closes_at;
    clockOverride=(await row(pool,"select ($1::timestamptz-interval '1 microsecond')::text t",[close])).t;
    await reject(()=>request('result.model',student,{attemptId:f.result}),'model_unavailable');clockOverride=close;
    await request('result.model',student,{attemptId:f.result});clockOverride=null;
  });
  await test('M04-exam-limit-and-malformed-facts-fail-closed',async()=>{
    const now=(await row(pool,'select clock_timestamp()::text t')).t;
    const make=r=>createAuthorizer({resolveSession:async()=>sessions.get(other),loadAccount:id=>row(pool,'select * from app_private.accounts where id=$1',[id]),loadResource:async()=>r,clock:async()=>now});
    const access=(await row(pool,'select * from app_private.course_access where student_id=$1',[f.s2]));
    const r={access,courseId:f.course,lessonId:f.lesson,lessonCourseId:f.course,assessmentCourseId:f.course,courseStatus:'published',lessonPublished:true,gateOpen:true,assessmentPublished:true,attemptKind:'exam',attemptsUsed:3,maxAttempts:3};
    await reject(()=>make(r)('attempt.start',other),'attempt_unavailable');await reject(()=>make({...r,maxAttempts:undefined})('attempt.start',other),'invalid_server_facts');
    const model={ownerId:f.s2,attempt:{status:'submitted',kind:'exam'},attemptsUsed:2,maxAttempts:3};
    await reject(()=>make(model)('result.model',other),'model_unavailable');await make({...model,attemptsUsed:3})('result.model',other);
    await reject(()=>make({...model,maxAttempts:undefined})('result.model',other),'invalid_server_facts');
  });
  await test('C03-used-or-missing-draft-edit-denied',async()=>{
    await reject(()=>request('admin.lessonDraftEdit',admin,{lessonId:f.lesson}),'used_lesson');
    await reject(()=>request('admin.lessonDraftEdit',admin,{lessonId:randomUUID()}),'resource_not_found');
  });
  await test('L01-lesson-gate-and-targeted-override',async()=>{
    await reject(()=>request('video.open',other,{courseId:f.course,lessonId:f.second}),'lesson_locked');
    await pool.query("insert into app_private.gate_overrides(student_id,lesson_id,granted_by,reason,granted_at,operation_id) values($1,$2,$3,'fixture support',clock_timestamp(),$4)",[f.s2,f.second,f.admin,randomUUID()]);
    await request('video.open',other,{courseId:f.course,lessonId:f.second});await reject(()=>request('video.open',student,{courseId:f.course,lessonId:f.second}),'access_required');
  });
  await test('S01-support-reason-and-disabled-target',async()=>{
    await reject(()=>request('admin.accessExtend',admin,{studentId:f.s1,courseId:f.course,days:7}),'reason_required');
    await pool.query("update app_private.accounts set status='disabled' where id=$1",[f.s1]);
    await request('admin.accessExtend',admin,{studentId:f.s1,courseId:f.course,days:7,reason:'fixture compensation'});
    await request('admin.studentEnable',admin,{studentId:f.s1});
    await pool.query("update app_private.accounts set status='active' where id=$1",[f.s1]);
  });
  await test('K01-used-owner-replay-survives-archive-no-other-owner',async()=>{
    await pool.query("update app_private.courses set status='archived',archived_at=clock_timestamp() where id=$1",[f.course]);
    await request('code.activate',student,{codeId:f.usedCode,courseId:f.course});
    await reject(()=>request('code.activate',other,{codeId:f.usedCode,courseId:f.course}),'code_unavailable');
    await reject(()=>request('catalog.detail',null,{courseId:f.course}),'resource_not_found');
  });
  await test('W01-worker-finalization-independent-of-disabled-account',async()=>{
    const now=(await row(pool,'select clock_timestamp()::text t')).t;
    const worker=createInternalAuthorizer({allowedOperations:['internal.autosubmit'],clock:async()=>now});
    const facts={attempt:{status:'in_progress',deadline_at:now},accountStatus:'disabled',withdrawn:true};
    await worker('internal.autosubmit',facts);await reject(()=>worker('internal.videoStatus',{}),'operation_denied');
  });
  await test('W02-provider-event-requires-current-generation',async()=>{
    const worker=createInternalAuthorizer({allowedOperations:['internal.videoStatus'],clock:()=>clock(pool)});
    await reject(()=>worker('internal.videoStatus',{providerVerified:true,uploadGeneration:1,currentGeneration:2}),'upload_event_rejected');
    await worker('internal.videoStatus',{providerVerified:true,uploadGeneration:2,currentGeneration:2});
  });
  await test('P01-response-allowlists-exclude-answer-keys-and-code-secrets',async()=>{
    const input={id:'fixture',title:'title',prompt:'prompt',correct_option_id:'secret',explanation:'secret',code_digest:'secret',export_ciphertext:'secret',auth_epoch:1,role:'admin',current_video_id:'secret'};
    for(const kind of ['course','lesson','profile','assessment','question','option','attempt','result','codeHistory']){
      const output=project(kind,input);for(const k of ['correct_option_id','explanation','code_digest','export_ciphertext','auth_epoch','role','current_video_id'])assert(!Object.hasOwn(output,k));
    }
  });
  const p=await request('student.profile',student);
  await test('DB01-invoker-views-return-own-history-only',async()=>{
    const profile=await readOwn(p,'select * from app_read.my_profile');assert(profile.rows.length===1&&profile.rows[0].id===f.s1);
    const result=await readOwn(p,'select * from app_read.my_results');assert(result.rows.length===1&&result.rows[0].attempt_id===f.result);
    assert((await readOwn(p,'select * from app_read.my_access')).rowCount===1);assert((await readOwn(p,'select * from app_read.my_progress')).rowCount===1);
    const views=await pool.query("select reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_read' and relkind='v'");assert(views.rowCount===4&&views.rows.every(x=>x.reloptions.includes('security_invoker=true')));
  });
  await test('DB02-reader-has-no-write-or-secret-column-privileges',async()=>{
    await reject(()=>readOwn(p,'update app_private.accounts set role=\'admin\''),'42501');
    await reject(()=>readOwn(p,'update app_private.course_access set access_until=clock_timestamp()'),'42501');
    await reject(()=>readOwn(p,'select role from app_private.accounts'),'42501');
    await reject(()=>readOwn(p,'select * from app_private.answer_keys'),'42501');await reject(()=>readOwn(p,'select * from app_private.activation_codes'),'42501');
  });
  await test('DB03-live-account-and-epoch-still-limit-reader',async()=>{
    await pool.query("update app_private.accounts set status='disabled' where id=$1",[f.s1]);assert((await readOwn(p,'select * from app_read.my_results')).rowCount===0);
    await pool.query("update app_private.accounts set status='active',auth_epoch=2 where id=$1",[f.s1]);assert((await readOwn(p,'select * from app_read.my_profile')).rowCount===0);
    await pool.query('update app_private.accounts set auth_epoch=1 where id=$1',[f.s1]);
  });
  await test('DB04-transaction-scope-does-not-leak-into-reused-connection',async()=>{
    const c=await pool.connect();try{
      await c.query('begin');await c.query(`set local role ${reader}`);await c.query("select set_config('app.actor_id',$1,true),set_config('app.auth_epoch','1',true)",[f.s1]);
      assert((await c.query('select * from app_read.my_profile')).rowCount===1);await c.query('commit');
      await c.query('begin');await c.query(`set local role ${reader}`);assert((await c.query('select * from app_read.my_profile')).rowCount===0);await c.query('commit');
    }catch(e){await c.query('rollback');throw e;}finally{c.release();}
  });
  await test('DB05-browser-roles-have-no-private-schema-entry',async()=>{
    for(const role of ['anon','authenticated']){
      const r=await row(pool,"select has_schema_privilege($1,'app_read','USAGE') a,has_schema_privilege($1,'app_private','USAGE') p",[role]);assert(!r.a&&!r.p);
    }
    for(const role of ['anon','authenticated'])await reject(()=>transaction(pool,async c=>{await c.query(`set local role ${role}`);return c.query('select * from app_read.my_profile');}),'42501');
  });
}catch(e){report.error={check,code:safe(e),...(e.readKind?{readKind:e.readKind}:{}),
  ...(/^permission denied for (?:table|schema|function) [a-z_]+$/.test(e.message??'')?{diagnostic:e.message}:{})};}finally{
  try{
    if(pool)await pool.end();
    if(dbCreated){const r=(await root.query("select datname,pg_get_userbyid(datdba)=current_user owned,shobj_description(oid,'pg_database') marker from pg_database where datname=$1",[dbName])).rows[0];
      assert(r?.datname===dbName&&r.owned&&r.marker===marker);assert(!(await root.query('select 1 from pg_stat_activity where datname=$1',[dbName])).rowCount);
      await root.query(`drop database ${dbName}`);report.databaseRemoved=!(await root.query('select 1 from pg_database where datname=$1',[dbName])).rowCount;}
    if(roleCreated){const r=(await root.query("select rolname,rolcanlogin,rolsuper,rolbypassrls,shobj_description(oid,'pg_authid') marker from pg_roles where rolname=$1",[reader])).rows[0];
      assert(r?.rolname===reader&&!r.rolcanlogin&&!r.rolsuper&&!r.rolbypassrls&&r.marker===marker);
      await root.query(`drop role ${reader}`);report.roleRemoved=!(await root.query('select 1 from pg_roles where rolname=$1',[reader])).rowCount;}
    if(baseline)report.baselineCountsUnchanged=JSON.stringify(await snapshot())===JSON.stringify(baseline);
  }catch(e){report.cleanupError=safe(e);}
  if(root)await root.end();report.pass=!report.error&&report.checks.length>0&&report.checks.every(x=>x.pass)&&report.databaseRemoved&&report.roleRemoved&&report.baselineCountsUnchanged;
  await writeFile(new URL('../../docs/phase-2/F04-validation-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
}
