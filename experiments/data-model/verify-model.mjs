import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { localSettings } from '../auth-spike/scripts/local-runtime.mjs';
import { activate, supportAccess, cancelCode, transaction } from './transaction-prototype.mjs';
const require = createRequire(new URL('../auth-spike/package.json', import.meta.url));
const { Client, Pool, types } = require('pg');
// Preserve PostgreSQL microseconds; arithmetic is performed by PostgreSQL, never JS Date.
types.setTypeParser(1184, value => value);
const run = randomUUID().replaceAll('-','');
const name = `dorosna_f03_${run}`;
if (!/^dorosna_f03_[a-f0-9]{32}$/.test(name)) throw new Error('invalid test database name');
const marker = `F03-owned-disposable-${run}`;
const report = { phase:'F03', scope:'draft DDL and test-only transactions; no HTTP/Auth/provider integration',
  date:'2026-10-02', checks:[], tableCount:null, cleanup:false, existingStackUnchanged:false, pass:false };
let adminConnection, pool, created = false, baseline;
let currentCheck = 'setup';
function assert(value) { if (!value) throw Object.assign(new Error('assertion'),{code:'assertion_failed'}); }
function safeCode(e) { return typeof e?.code === 'string' && /^[a-zA-Z0-9_]{1,50}$/.test(e.code) ? e.code : 'unclassified_error'; }
async function test(id, fn) {
  currentCheck = id;
  try { await fn(); report.checks.push({id,pass:true}); }
  catch(e) { report.checks.push({id,pass:false,code:safeCode(e)}); throw e; }
}
async function reject(fn, expected) {
  let code;
  try { await fn(); } catch(e) { code = e.code; }
  assert(Array.isArray(expected) ? expected.includes(code) : code === expected);
}
async function existingSnapshot(client) {
  const {rows: tables} = await client.query("select tablename from pg_tables where schemaname='auth_spike_private' order by tablename");
  const counts = {};
  for (const {tablename} of tables) {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error('unexpected table');
    const {rows:[r]} = await client.query(`select count(*)::integer n from auth_spike_private.${tablename}`);
    counts[tablename] = r.n;
  }
  const {rows:[r]} = await client.query('select count(*)::integer n from auth.users');
  return {counts,authUsers:r.n};
}
async function value(sql, args=[]) { return (await pool.query(sql,args)).rows[0]; }
async function access(student,course) { return value('select * from app_private.course_access where student_id=$1 and course_id=$2',[student,course]); }
const f={};
const heldBlockers=new Set();
async function newCourse(environment='development') {
  const c = randomUUID(), unit=randomUUID(), lesson=randomUUID(), video=randomUUID();
  await pool.query(`insert into app_private.courses(id,teacher_id,grade_id,subject_id,title,delivery_environment)
    values($1,$2,$3,$4,'fixture course',$5)`,[c,f.teacher,f.grade,f.subject,environment]);
  await pool.query("insert into app_private.course_units(id,course_id,title,position) values($1,$2,'unit',1)",[unit,c]);
  await pool.query("insert into app_private.lessons(id,course_id,unit_id,position,title) values($1,$2,$3,1,'lesson')",[lesson,c,unit]);
  await pool.query(`insert into app_private.video_uploads(id,lesson_id,generation,provider,local_fixture_ref,state,verification,duration_seconds)
    values($1,$2,1,'local','fixture-only.mp4','ready','fixture',60)`,[video,lesson]);
  await pool.query('update app_private.lessons set current_video_id=$2 where id=$1',[lesson,video]);
  if (environment==='development') {
    await pool.query('update app_private.lessons set published_at=clock_timestamp() where id=$1',[lesson]);
    await pool.query("update app_private.courses set status='published',published_at=clock_timestamp() where id=$1",[c]);
  }
  return {c,unit,lesson,video};
}
async function newCode(course, days=30, expired=false) {
  const batch=randomUUID(), code=randomUUID();
  await transaction(pool,async client=>{
    await client.query(`insert into app_private.code_batches(id,course_id,duration_days,quantity,created_by,request_id,request_digest,created_at,activate_before)
      values($1,$2,$3,1,$4,$5,$6,clock_timestamp()-interval '2 hours',case when $7 then clock_timestamp()-interval '1 hour' else null end)`,
    [batch,course,days,f.admin,randomUUID(),randomBytes(32),expired]);
    await client.query(`insert into app_private.activation_codes(id,batch_id,course_id,duration_days,code_digest,export_ciphertext,encryption_key_id,masked_suffix)
      values($1,$2,$3,$4,$5,$6,'fixture-key-not-real','TEST')`,[code,batch,course,days,randomBytes(32),Buffer.from('fixture ciphertext')]);
  });
  return {batch,code};
}
async function newAssessment(course, kind='exam', lesson=null) {
  const a=randomUUID();
  await pool.query(`insert into app_private.assessments(id,course_id,kind,lesson_id,title)
    values($1,$2,$3,$4,'fixture assessment')`,[a,course,kind,lesson]);
  return a;
}
async function newVersion(a, course, number=1, kind='exam') {
  const v=randomUUID(), q=randomUUID(), o1=randomUUID(), o2=randomUUID();
  await transaction(pool,async client=>{
    await client.query(`insert into app_private.assessment_versions(id,assessment_id,course_id,kind,version_number,duration_seconds,max_attempts,pass_percent)
      values($1,$2,$3,$4,$5,case when $4='exam' then 1200 else null end,case when $4='exam' then 1 else null end,70)`,[v,a,course,kind,number]);
    await client.query("insert into app_private.questions(id,version_id,position,prompt,points) values($1,$2,1,'fixture question',10)",[q,v]);
    await client.query("insert into app_private.question_options(id,version_id,question_id,position,label) values($1,$2,$3,1,'A'),($4,$2,$3,2,'B')",[o1,v,q,o2]);
    await client.query('insert into app_private.answer_keys(version_id,question_id,correct_option_id) values($1,$2,$3)',[v,q,o1]);
    await client.query('update app_private.assessment_versions set published_at=clock_timestamp() where id=$1',[v]);
    await client.query('update app_private.assessments set current_version_id=$2 where id=$1',[a,v]);
  });
  return {v,q,o1,o2};
}
async function newAttempt(student,a,version,course,number=1,expired=false,kind='exam') {
  const id=randomUUID();
  await pool.query(`insert into app_private.attempts(id,student_id,assessment_id,version_id,course_id,kind,attempt_number,started_at,deadline_at)
    values($1,$2,$3,$4,$5,$6,$7,clock_timestamp()-interval '20 minutes',
    case when $6='homework' then null when $8 then clock_timestamp()-interval '1 second' else clock_timestamp()+interval '20 minutes' end)`,
  [id,student,a,version,course,kind,number,expired]);
  return id;
}
async function finalize(attempt, earned=10, possible=10) {
  return transaction(pool,async client=>{
    const {rows:[a]}=await client.query('select * from app_private.attempts where id=$1 for update',[attempt]);
    if(a.status==='submitted') return 'replay';
    // Fixture score only: this helper verifies atomic final state, not a grading implementation.
    await client.query('insert into app_private.attempt_results(attempt_id,earned_points,possible_points,passed,graded_at) values($1,$2,$3,true,clock_timestamp())',[attempt,earned,possible]);
    await client.query("update app_private.attempts set status='submitted',submitted_at=clock_timestamp(),submission_kind='manual',result_id=id where id=$1",[attempt]);
    return 'submitted';
  });
}
async function blockedBy(rowSql, args, action) {
  const blocker=await pool.connect(), worker=await pool.connect();
  let pid, task;
  try {
    await blocker.query('begin');
    await blocker.query(rowSql,args);
    pid=(await worker.query('select pg_backend_pid() pid')).rows[0].pid;
    // Use this single client through the pool-shaped transaction interface.
    const wrapper={connect:async()=>({query:worker.query.bind(worker),release:()=>{}})};
    task=action(wrapper).then(result=>({ok:true,result}),e=>({ok:false,code:safeCode(e)}));
    let waited=false;
    for(let i=0;i<200;i++) {
      const r=await value("select wait_event_type='Lock' as waiting from pg_stat_activity where pid=$1",[pid]);
      if(r?.waiting) { waited=true; break; }
      await delay(20);
    }
    assert(waited);
    const held={blocker,worker,task}; heldBlockers.add(held); return held;
  } catch(e) {
    await blocker.query('rollback');
    if(task) await task;
    blocker.release(); worker.release(); throw e;
  }
}
async function releaseBlocked(b) { await b.blocker.query('commit'); const out=await b.task; b.blocker.release(); b.worker.release(); heldBlockers.delete(b); return out; }

try {
  const settings=localSettings();
  adminConnection=new Client({connectionString:settings.DB_URL,connectionTimeoutMillis:5000});
  await adminConnection.connect();
  baseline=await existingSnapshot(adminConnection);
  const {rows:[server]}=await adminConnection.query("select current_setting('server_version') version");
  report.postgresVersion=server.version;
  assert(!(await adminConnection.query('select 1 from pg_database where datname=$1',[name])).rowCount);
  await adminConnection.query(`create database ${name}`); created=true;
  await adminConnection.query(`comment on database ${name} is '${marker}'`);
  const url=new URL(settings.DB_URL); url.pathname=`/${name}`;
  pool=new Pool({connectionString:url.href,max:8,connectionTimeoutMillis:5000,idleTimeoutMillis:5000});
  await test('DDL-01-schema-applies',async()=>{
    await pool.query(await readFile(new URL('./schema-draft.sql',import.meta.url),'utf8'));
    report.tableCount=(await value("select count(*)::integer n from pg_tables where schemaname='app_private'")).n;
    assert(report.tableCount===28);
  });
  await test('DDL-02-foreign-key-leading-indexes',async()=>{
    const r=await value(`select count(*)::integer n from pg_constraint c
      join pg_namespace n on n.oid=c.connamespace where n.nspname='app_private' and c.contype='f'
      and not exists(select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid
        and i.indpred is null and i.indkey[0]=c.conkey[1])`);
    assert(r.n===0);
  });
  for (const k of ['grade','subject','teacher','admin','s1','s2']) f[k]=randomUUID();
  await pool.query("insert into app_private.grades(id,name,sort_order) values($1,'fixture grade',1)",[f.grade]);
  await pool.query("insert into app_private.subjects(id,name) values($1,'fixture subject')",[f.subject]);
  await pool.query("insert into app_private.teachers(id,name) values($1,'fixture teacher')",[f.teacher]);
  for (const [key,role,phone] of [['admin','admin','+201000000001'],['s1','student','+201000000002'],['s2','student','+201000000003']]) {
    await pool.query('insert into app_private.accounts(id,phone,full_name,role,provisioning_locked) values($1,$2,$3,$4,false)',[f[key],phone,'fixture account',role]);
    if(role==='student') await pool.query('insert into app_private.student_profiles(account_id,grade_id) values($1,$2)',[f[key],f.grade]);
  }
  await test('A-01-phone-unique',()=>reject(()=>pool.query("insert into app_private.accounts(phone,full_name,role) values('+201000000002','duplicate','student')"),'23505'));
  await test('A-02-admin-cannot-be-student-profile',()=>reject(()=>pool.query('insert into app_private.student_profiles(account_id,grade_id) values($1,$2)',[f.admin,f.grade]),'23503'));
  f.course=await newCourse(); f.other=await newCourse();
  await test('C-01-lesson-unit-same-course',()=>reject(()=>pool.query("insert into app_private.lessons(course_id,unit_id,position,title) values($1,$2,2,'invalid')",[f.course.c,f.other.unit]),'23503'));
  await test('C-02-published-lesson-no-reorder',()=>reject(()=>pool.query('update app_private.lessons set position=10 where id=$1',[f.course.lesson]),'23514'));
  await test('C-03-published-lesson-no-delete',()=>reject(()=>pool.query('delete from app_private.lessons where id=$1',[f.course.lesson]),'23514'));
  await test('C-04-live-publication-rejects-fixture-video',async()=>{ const c=await newCourse('live'); await reject(()=>pool.query('update app_private.lessons set published_at=clock_timestamp() where id=$1',[c.lesson]),'23514'); });
  await test('C-05-ready-video-required',async()=>{
    const l=randomUUID(); await pool.query("insert into app_private.lessons(id,course_id,unit_id,position,title) values($1,$2,$3,2,'unready')",[l,f.course.c,f.course.unit]);
    await reject(()=>pool.query('update app_private.lessons set published_at=clock_timestamp() where id=$1',[l]),'23514');
  });
  await test('K-01-duration-restricted',()=>reject(()=>pool.query(`insert into app_private.code_batches(course_id,duration_days,quantity,created_by,request_id,request_digest)
    values($1,31,1,$2,$3,$4)`,[f.course.c,f.admin,randomUUID(),randomBytes(32)]),'23514'));
  await test('K-02-batch-request-unique',async()=>{
    const c=await newCode(f.course.c); const b=await value('select * from app_private.code_batches where id=$1',[c.batch]);
    await reject(()=>pool.query(`insert into app_private.code_batches(course_id,duration_days,quantity,created_by,request_id,request_digest)
      values($1,30,1,$2,$3,$4)`,[f.course.c,f.admin,b.request_id,b.request_digest]),'23505');
  });
  await test('K-03-confirmed-course-no-consumption',async()=>{
    const c=await newCode(f.course.c); await reject(()=>activate(pool,f.s1,c.code,f.other.c),'course_mismatch');
    assert((await value('select count(*)::integer n from app_private.activations where code_id=$1',[c.code])).n===0);
  });
  await test('K-04-expired-code-no-consumption',async()=>{ const c=await newCode(f.course.c,30,true); await reject(()=>activate(pool,f.s1,c.code,f.course.c),'code_expired'); });
  await test('K-05-activation-needs-linked-grant-at-commit',async()=>{
    const c=await newCode(f.course.c);
    await reject(()=>transaction(pool,client=>client.query(`insert into app_private.activations(code_id,student_id,course_id,duration_days,access_event_id,activated_at)
      values($1,$2,$3,30,$4,clock_timestamp())`,[c.code,f.s1,f.course.c,randomUUID()])),'23503');
  });
  await test('K-06-injected-failure-rolls-back-code-grant-audit',async()=>{
    const c=await newCode(f.course.c);
    await reject(()=>activate(pool,f.s1,c.code,f.course.c,{abortBeforeCommit:true}),'injected_rollback');
    assert(!(await access(f.s1,f.course.c)));
    assert((await value('select count(*)::integer n from app_private.activations where code_id=$1',[c.code])).n===0);
    assert((await value('select count(*)::integer n from app_private.access_events')).n===0);
    assert((await value('select count(*)::integer n from app_private.audit_events')).n===0);
  });
  await test('K-07-two-students-one-code-concurrent',async()=>{
    const c=await newCode(f.course.c); const r=await Promise.allSettled([activate(pool,f.s1,c.code,f.course.c),activate(pool,f.s2,c.code,f.course.c)]);
    assert(r.filter(x=>x.status==='fulfilled').length===1 && r.filter(x=>x.status==='rejected' && x.reason.code==='code_unavailable').length===1);
    f.winner=r[0].status==='fulfilled'?f.s1:f.s2; f.used=c.code;
    assert((await value('select count(*)::integer n from app_private.activations where code_id=$1',[c.code])).n===1);
    const d=await value('select extract(epoch from (access_until-started_at)) seconds from app_private.course_access where student_id=$1 and course_id=$2',[f.winner,f.course.c]);
    assert(Number(d.seconds)===30*86400);
  });
  await test('K-08-owner-replay-adds-no-time',async()=>{const a=await access(f.winner,f.course.c); const r=await activate(pool,f.winner,f.used,f.course.c); assert(r.replay && r.access.access_until===a.access_until);});
  await test('E-01-two-renewals-preserve-both-durations',async()=>{
    const before=await access(f.winner,f.course.c), c1=await newCode(f.course.c,30),c2=await newCode(f.course.c,60);
    await Promise.all([activate(pool,f.winner,c1.code,f.course.c),activate(pool,f.winner,c2.code,f.course.c)]);
    const d=await value('select extract(epoch from (access_until-$3::timestamptz)) seconds from app_private.course_access where student_id=$1 and course_id=$2',[f.winner,f.course.c,before.access_until]);
    assert(Number(d.seconds)===90*86400);
  });
  await test('E-02-withdrawn-old-code-replay-keeps-withdrawal',async()=>{
    await supportAccess(pool,f.admin,f.winner,f.course.c,'withdrawal');
    const r=await activate(pool,f.winner,f.used,f.course.c); assert(r.replay && r.access.withdrawn_at);
  });
  await test('E-03-new-code-restarts-after-withdrawal-D28',async()=>{
    const before=await access(f.winner,f.course.c),c=await newCode(f.course.c);
    const r=await activate(pool,f.winner,c.code,f.course.c); assert(!r.access.withdrawn_at && r.access.epoch===before.epoch+1);
    const d=await value('select extract(epoch from(access_until-started_at)) seconds,access_until<$3::timestamptz shorter from app_private.course_access where student_id=$1 and course_id=$2',[f.winner,f.course.c,before.access_until]);
    assert(Number(d.seconds)===30*86400 && d.shorter);
    assert((await value("select count(*)::integer n from app_private.access_events where student_id=$1 and course_id=$2 and kind='withdrawal'",[f.winner,f.course.c])).n===1);
  });
  await test('E-04-extension-adds-time-does-not-enable-account',async()=>{
    await pool.query("update app_private.accounts set status='disabled' where id=$1",[f.winner]);
    const before=await access(f.winner,f.course.c); await supportAccess(pool,f.admin,f.winner,f.course.c,'extension',7);
    const d=await value('select extract(epoch from(access_until-$3::timestamptz)) seconds from app_private.course_access where student_id=$1 and course_id=$2',[f.winner,f.course.c,before.access_until]);
    assert(Number(d.seconds)===7*86400 && (await value('select status from app_private.accounts where id=$1',[f.winner])).status==='disabled');
    await pool.query("update app_private.accounts set status='active' where id=$1",[f.winner]);
  });
  await test('K-09-cancel-wins-blocked-activation',async()=>{
    const c=await newCode(f.course.c);
    const b=await blockedBy('select id from app_private.activation_codes where id=$1 for update',[c.code],p=>activate(p,f.winner,c.code,f.course.c));
    await b.blocker.query("update app_private.activation_codes set cancelled_at=clock_timestamp(),cancelled_by=$2,cancellation_reason='race fixture' where id=$1",[c.code,f.admin]);
    const r=await releaseBlocked(b); assert(!r.ok && r.code==='code_unavailable');
    assert((await value('select count(*)::integer n from app_private.activations where code_id=$1',[c.code])).n===0);
  });
  await test('K-10-used-code-cannot-cancel',()=>reject(()=>cancelCode(pool,f.admin,f.used),'23514'));
  await test('A-03-disable-wins-blocked-activation',async()=>{
    const c=await newCode(f.course.c);
    const b=await blockedBy('select id from app_private.accounts where id=$1 for update',[f.winner],p=>activate(p,f.winner,c.code,f.course.c));
    await b.blocker.query("update app_private.accounts set status='disabled' where id=$1",[f.winner]);
    const r=await releaseBlocked(b); assert(!r.ok && r.code==='account_denied');
    await pool.query("update app_private.accounts set status='active' where id=$1",[f.winner]);
  });
  await test('C-06-archive-wins-blocked-activation',async()=>{
    const c=await newCode(f.course.c);
    const b=await blockedBy('select id from app_private.courses where id=$1 for update',[f.course.c],p=>activate(p,f.winner,c.code,f.course.c));
    await b.blocker.query("update app_private.courses set status='archived',archived_at=clock_timestamp() where id=$1",[f.course.c]);
    const r=await releaseBlocked(b); assert(!r.ok && r.code==='code_unavailable');
  });
  await test('C-07-archived-owner-replay-preserves-access',async()=>{const r=await activate(pool,f.winner,f.used,f.course.c);assert(r.replay && !r.access.withdrawn_at);});
  f.assessment=await newAssessment(f.other.c); f.v1=await newVersion(f.assessment,f.other.c);
  f.attempt=await newAttempt(f.s1,f.assessment,f.v1.v,f.other.c);
  await test('M-01-one-active-attempt-across-versions',async()=>{
    f.v2=await newVersion(f.assessment,f.other.c,2);
    await reject(()=>newAttempt(f.s1,f.assessment,f.v2.v,f.other.c,2),'23505');
    assert((await value('select version_id from app_private.attempts where id=$1',[f.attempt])).version_id===f.v1.v);
  });
  await test('M-02-answer-must-belong-to-attempt-version',()=>reject(()=>pool.query(`insert into app_private.attempt_answers(attempt_id,version_id,question_id,selected_option_id,revision,received_at)
    values($1,$2,$3,$4,1,clock_timestamp())`,[f.attempt,f.v2.v,f.v2.q,f.v2.o1]),'23503'));
  await test('M-03-answer-option-must-belong-to-question',()=>reject(()=>pool.query(`insert into app_private.attempt_answers(attempt_id,version_id,question_id,selected_option_id,revision,received_at)
    values($1,$2,$3,$4,1,clock_timestamp())`,[f.attempt,f.v1.v,f.v1.q,f.v2.o1]),'23503'));
  await test('M-04-published-question-key-settings-frozen',async()=>{
    await reject(()=>pool.query("update app_private.questions set prompt='changed' where id=$1",[f.v1.q]),'23514');
    await reject(()=>pool.query('update app_private.answer_keys set correct_option_id=$2 where version_id=$1',[f.v1.v,f.v1.o2]),'23514');
    await reject(()=>pool.query('update app_private.assessment_versions set max_attempts=9 where id=$1',[f.v1.v]),'23514');
  });
  await test('M-05-stale-answer-revision-rejected',async()=>{
    await pool.query(`insert into app_private.attempt_answers(attempt_id,version_id,question_id,selected_option_id,revision,received_at)
      values($1,$2,$3,$4,2,clock_timestamp())`,[f.attempt,f.v1.v,f.v1.q,f.v1.o1]);
    await reject(()=>pool.query('update app_private.attempt_answers set selected_option_id=$3,revision=1 where attempt_id=$1 and question_id=$2',[f.attempt,f.v1.q,f.v1.o2]),'23514');
    assert((await value('select selected_option_id from app_private.attempt_answers where attempt_id=$1',[f.attempt])).selected_option_id===f.v1.o1);
  });
  await test('M-06-expired-attempt-rejects-answers',async()=>{
    const a=await newAssessment(f.other.c),v=await newVersion(a,f.other.c),t=await newAttempt(f.s2,a,v.v,f.other.c,1,true);
    await reject(()=>pool.query(`insert into app_private.attempt_answers(attempt_id,version_id,question_id,selected_option_id,revision,received_at)
      values($1,$2,$3,$4,1,clock_timestamp())`,[t,v.v,v.q,v.o1]),'23514');
  });
  await test('M-07-final-state-needs-result-at-commit',()=>reject(()=>transaction(pool,c=>c.query("update app_private.attempts set status='submitted',submitted_at=clock_timestamp(),submission_kind='manual',result_id=id where id=$1",[f.attempt])),'23503'));
  await test('M-08-two-finalizers-one-result',async()=>{
    const r=await Promise.all([finalize(f.attempt),finalize(f.attempt)]); assert(r.includes('submitted') && r.includes('replay'));
    assert((await value('select count(*)::integer n from app_private.attempt_results where attempt_id=$1',[f.attempt])).n===1);
    await reject(()=>pool.query('update app_private.attempt_results set earned_points=0 where attempt_id=$1',[f.attempt]),'23514');
    await reject(()=>pool.query('update app_private.attempt_answers set revision=3 where attempt_id=$1',[f.attempt]),'23514');
  });
  await test('M-09-version-change-does-not-reset-attempt-number',()=>reject(()=>newAttempt(f.s1,f.assessment,f.v2.v,f.other.c,1),'23505'));
  await test('M-10-incomplete-assessment-cannot-publish',async()=>{
    const a=await newAssessment(f.other.c),v=randomUUID();
    await pool.query("insert into app_private.assessment_versions(id,assessment_id,course_id,kind,version_number,duration_seconds,max_attempts,pass_percent) values($1,$2,$3,'exam',1,60,1,70)",[v,a,f.other.c]);
    await reject(()=>pool.query('update app_private.assessment_versions set published_at=clock_timestamp() where id=$1',[v]),'23514');
  });
  await test('L-01-sticky-homework-pass-keeps-first-result',async()=>{
    const a=await newAssessment(f.other.c,'homework',f.other.lesson),v=await newVersion(a,f.other.c,1,'homework'),t=await newAttempt(f.s1,a,v.v,f.other.c,1,false,'homework');
    await finalize(t);
    await pool.query('insert into app_private.homework_passes(student_id,assessment_id,course_id,first_pass_attempt_id,passed_at) values($1,$2,$3,$4,clock_timestamp())',[f.s1,a,f.other.c,t]);
    await reject(()=>pool.query('delete from app_private.homework_passes where student_id=$1 and assessment_id=$2',[f.s1,a]),'23514');
  });
  await test('L-02-no-rounding-69-point-9-to-pass',async()=>{
    const a=(await value("select id from app_private.assessments where lesson_id=$1 and kind='homework'",[f.other.lesson])).id;
    const v=(await value('select current_version_id from app_private.assessments where id=$1',[a])).current_version_id;
    const t=await newAttempt(f.s2,a,v,f.other.c,1,false,'homework');
    await finalize(t,69.9,100);
    await reject(()=>pool.query('insert into app_private.homework_passes(student_id,assessment_id,course_id,first_pass_attempt_id,passed_at) values($1,$2,$3,$4,clock_timestamp())',[f.s2,a,f.other.c,t]),'23514');
  });
  await test('L-03-completion-is-sticky-and-position-independent',async()=>{
    await pool.query('insert into app_private.lesson_progress(student_id,lesson_id,position_seconds) values($1,$2,60)',[f.s1,f.other.lesson]);
    assert((await value('select completed_at from app_private.lesson_progress where student_id=$1 and lesson_id=$2',[f.s1,f.other.lesson])).completed_at===null);
    await pool.query('update app_private.lesson_progress set completed_at=clock_timestamp(),revision=2 where student_id=$1 and lesson_id=$2',[f.s1,f.other.lesson]);
    await reject(()=>pool.query('update app_private.lesson_progress set completed_at=null,revision=3 where student_id=$1 and lesson_id=$2',[f.s1,f.other.lesson]),'23514');
  });
  await test('V-01-one-watch-lease-per-student',async()=>{
    const insert=(lesson)=>pool.query(`insert into app_private.watch_leases(student_id,lesson_id,generation,device_digest,token_digest,acquired_at,heartbeat_at,expires_at)
      values($1,$2,1,$3,$4,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 minute')`,[f.s1,lesson,randomBytes(32),randomBytes(32)]);
    await insert(f.course.lesson); await reject(()=>insert(f.other.lesson),'23505');
  });
  await test('H-01-access-history-immutable',()=>reject(()=>pool.query('update app_private.access_events set added_days=0'),'23514'));
  await test('H-02-used-account-cannot-delete-history',()=>reject(()=>pool.query('delete from app_private.accounts where id=$1',[f.winner]),'23503'));
} catch(e) {
  report.error={check:currentCheck,code:safeCode(e)};
} finally {
  try {
    for(const b of heldBlockers) {
      await b.blocker.query('rollback'); await b.task;
      b.blocker.release(); b.worker.release(); heldBlockers.delete(b);
    }
    if(pool) await pool.end();
    if(created && adminConnection) {
      const {rows:[db]}=await adminConnection.query(`select oid,datname,pg_get_userbyid(datdba)=current_user as owned,
        shobj_description(oid,'pg_database') as marker from pg_database where datname=$1`,[name]);
      assert(db?.datname===name && db.owned && db.marker===marker && name!== 'postgres');
      assert((await adminConnection.query('select 1 from pg_stat_activity where datname=$1',[name])).rowCount===0);
      await adminConnection.query(`drop database ${name}`);
      report.cleanup=(await adminConnection.query('select 1 from pg_database where datname=$1',[name])).rowCount===0;
      report.existingStackUnchanged=JSON.stringify(await existingSnapshot(adminConnection))===JSON.stringify(baseline);
    }
  } catch(e) { report.cleanupError=safeCode(e); }
  if(adminConnection) await adminConnection.end();
  report.pass=!report.error && report.checks.length>0 && report.checks.every(x=>x.pass) && report.cleanup && report.existingStackUnchanged;
  await writeFile(new URL('../../docs/phase-2/F03-validation-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(!report.pass) process.exitCode=1;
}
