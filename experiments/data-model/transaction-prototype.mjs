// Test-only database transactions. No HTTP entry points or trusted identity adapter.
// Never treat caller-supplied UUIDs here as production authentication.
import { randomUUID } from 'node:crypto';

export async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '10s'");
    const value = await action(client);
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { client.release(); }
}
function deny(reason) { const e = new Error(reason); e.code = reason; throw e; }
async function liveAccount(client, id, role, allowDisabled = false) {
  const { rows: [a] } = await client.query('select * from app_private.accounts where id=$1 for update', [id]);
  if (!a || a.role !== role || a.provisioning_locked || a.recovery_locked || (!allowDisabled && a.status !== 'active')) deny('account_denied');
  return a;
}

export function activate(pool, student, code, confirmedCourse, { abortBeforeCommit = false } = {}) {
  return transaction(pool, async client => {
    await liveAccount(client, student, 'student');
    const { rows: [lookup] } = await client.query('select course_id from app_private.activation_codes where id=$1', [code]);
    if (!lookup || lookup.course_id !== confirmedCourse) deny('course_mismatch');
    const { rows: [course] } = await client.query('select status from app_private.courses where id=$1 for share', [confirmedCourse]);
    const { rows: [c] } = await client.query(`select c.*, b.activate_before from app_private.activation_codes c
      join app_private.code_batches b on b.id=c.batch_id where c.id=$1 for update of c`, [code]);
    const { rows: [prior] } = await client.query('select * from app_private.activations where code_id=$1', [code]);
    const { rows: [access] } = await client.query('select * from app_private.course_access where student_id=$1 and course_id=$2 for update', [student,confirmedCourse]);
    if (prior) {
      if (prior.student_id !== student) deny('code_unavailable');
      return { replay: true, activation: prior.id, access };
    }
    const { rows: [clock] } = await client.query('select clock_timestamp()::text as t');
    if (course.status !== 'published' || c.cancelled_at) deny('code_unavailable');
    const { rows: [eligibility] } = await client.query('select $1::timestamptz is null or $2::timestamptz < $1::timestamptz as ok', [c.activate_before,clock.t]);
    if (!eligibility.ok) deny('code_expired');
    const { rows: [period] } = await client.query(`select
      case when $1::timestamptz is not null and $2::timestamptz is null and $1::timestamptz > $3::timestamptz
        then $4::timestamptz else $3::timestamptz end as starts,
      (case when $2::timestamptz is null then greatest($3::timestamptz,$1::timestamptz)
        else $3::timestamptz end) + ($5::integer * 86400) * interval '1 second' as ends,
      $1::timestamptz is not null and $2::timestamptz is null and $1::timestamptz > $3::timestamptz as continuous`,
    [access?.access_until ?? null,access?.withdrawn_at ?? null,clock.t,access?.started_at ?? null,c.duration_days]);
    const epoch = access ? access.epoch + (period.continuous ? 0 : 1) : 1;
    const kind = !access ? 'grant' : access.withdrawn_at ? 'regrant' : 'renewal';
    const activation = randomUUID(), event = randomUUID();
    await client.query(`insert into app_private.activations(id,code_id,student_id,course_id,duration_days,access_event_id,activated_at)
      values($1,$2,$3,$4,$5,$6,$7)`, [activation,code,student,confirmedCourse,c.duration_days,event,clock.t]);
    await client.query(`insert into app_private.access_events(id,student_id,course_id,epoch,kind,activation_id,actor_id,operation_id,added_days,occurred_at,access_started_at,access_until)
      values($1,$2,$3,$4,$5,$6,$2,$7,$8,$9,$10,$11)`, [event,student,confirmedCourse,epoch,kind,activation,randomUUID(),c.duration_days,clock.t,period.starts,period.ends]);
    await client.query(`insert into app_private.course_access(student_id,course_id,epoch,started_at,access_until,last_event_id)
      values($1,$2,$3,$4,$5,$6) on conflict(student_id,course_id) do update set epoch=excluded.epoch,
      started_at=excluded.started_at,access_until=excluded.access_until,last_event_id=excluded.last_event_id,withdrawn_at=null`,
    [student,confirmedCourse,epoch,period.starts,period.ends,event]);
    await client.query(`insert into app_private.audit_events(actor_id,action,target_type,target_id,operation_id)
      values($1,'activate','activation',$2,$3)`, [student,activation,randomUUID()]);
    if (abortBeforeCommit) deny('injected_rollback');
    const { rows: [current] } = await client.query('select * from app_private.course_access where student_id=$1 and course_id=$2', [student,confirmedCourse]);
    return { replay: false, activation, access: current };
  });
}

export function supportAccess(pool, admin, student, course, kind, days = 0) {
  return transaction(pool, async client => {
    // All account locks use the same order; operator and target may be different.
    for (const id of [admin,student].sort()) await liveAccount(client,id,id === admin ? 'admin' : 'student',id === student);
    await client.query('select id from app_private.courses where id=$1 for share', [course]);
    const { rows: [a] } = await client.query('select * from app_private.course_access where student_id=$1 and course_id=$2 for update',[student,course]);
    if (!a || (kind === 'extension' && a.withdrawn_at)) deny('access_denied');
    if (kind === 'withdrawal' && a.withdrawn_at) return a;
    if (!['withdrawal','extension'].includes(kind) || (kind === 'extension' && (!Number.isSafeInteger(days) || days <= 0))) deny('support_invalid');
    const { rows: [clock] } = await client.query('select clock_timestamp()::text t');
    const { rows: [period] } = await client.query(`select case when $1='extension'
      then greatest($2::timestamptz,$3::timestamptz) + ($4::bigint*86400)*interval '1 second'
      else $2::timestamptz end as ends`, [kind,a.access_until,clock.t,days]);
    const event = randomUUID();
    await client.query(`insert into app_private.access_events(id,student_id,course_id,epoch,kind,actor_id,operation_id,reason,added_days,occurred_at,access_started_at,access_until)
      values($1,$2,$3,$4,$5,$6,$7,'test support reason',$8,$9,$10,$11)`,[event,student,course,a.epoch,kind,admin,randomUUID(),kind==='extension'?days:0,clock.t,a.started_at,period.ends]);
    const {rows:[current]} = await client.query(`update app_private.course_access set access_until=$3,last_event_id=$4,
      withdrawn_at=case when $5='withdrawal' then $6::timestamptz else null end where student_id=$1 and course_id=$2 returning *`,
    [student,course,period.ends,event,kind,clock.t]);
    return current;
  });
}

export function cancelCode(pool, admin, code) {
  return transaction(pool, async client => {
    await liveAccount(client,admin,'admin');
    const { rows: [c] } = await client.query('select * from app_private.activation_codes where id=$1 for update',[code]);
    if (!c) deny('code_unavailable');
    if (c.cancelled_at) return;
    await client.query(`update app_private.activation_codes set cancelled_at=clock_timestamp(),cancelled_by=$2,
      cancellation_reason='test cancellation' where id=$1`,[code,admin]);
  });
}
