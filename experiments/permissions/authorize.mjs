import { operations } from './permission-contract.mjs';
export class PermissionError extends Error {
  constructor(code) { super(code); this.code=code; }
}
const deny=code=>{throw new PermissionError(code);};
function time(value) {
  if(typeof value!=='string') deny('invalid_server_facts');
  const m=value.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/);
  if(!m) deny('invalid_server_facts');
  const zone=m[3]==='Z'?'Z':m[3].length===3?`${m[3]}:00`:m[3].length===5?`${m[3].slice(0,3)}:${m[3].slice(3)}`:m[3];
  const seconds=Date.parse(`${m[1].replace(' ','T')}${zone}`);
  if(!Number.isFinite(seconds)) deny('invalid_server_facts');
  return BigInt(seconds)*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
function guardResource(name, f, actor, input, now) {
  const own=()=>{if(!f || f.ownerId!==actor.id) deny('resource_not_found');};
  const subscription=()=>{
    if(!f?.courseId||f.access?.course_id!==f.courseId) deny('resource_not_found');
    if(!f.access || f.access.withdrawn_at || now>=time(f.access.access_until)) deny('access_required');
    if(!['published','archived'].includes(f.courseStatus)) deny('content_unavailable');
  };
  const lesson=()=>{if(!f.lessonId||f.lessonCourseId!==f.courseId) deny('resource_not_found');if(f.lessonPublished!==true || f.gateOpen!==true) deny('lesson_locked');};
  const learning=()=>{subscription();lesson();};
  const ongoing=()=>{
    own(); if(f.attempt.status!=='in_progress') deny('attempt_closed');
    if(f.access?.withdrawn_at || !f.access) deny('access_required');
    if(!f.courseId||f.attempt.course_id!==f.courseId||f.access.course_id!==f.courseId) deny('resource_not_found');
    if(!['published','archived'].includes(f.courseStatus)) deny('content_unavailable');
    lesson();
    if(f.attempt.kind==='exam') {
      if(now>=time(f.attempt.deadline_at)) deny('attempt_closed');
      // Expiry exception applies to this persisted exam, never to a new attempt.
    } else subscription();
  };
  const studentTarget=()=>{if(f?.targetRole!=='student') deny('resource_not_found');};
  const reason=()=>{if(typeof input.reason!=='string'||!input.reason.trim()) deny('reason_required');};
  const attemptLimit=()=>{if(!Number.isSafeInteger(f.attemptsUsed)||f.attemptsUsed<0||!Number.isSafeInteger(f.maxAttempts)||f.maxAttempts<1) deny('invalid_server_facts');};
  switch(name) {
    case 'catalog': return;
    case 'publicCourse': if(f?.courseStatus!=='published') deny('resource_not_found'); return;
    case 'self': return;
    case 'owner': own(); return;
    case 'previewCode': case 'activateCode':
      if(!f?.courseId) deny('code_unavailable');
      if(name==='activateCode'&&input.courseId!==f.courseId) deny('course_mismatch');
      if(f.codeOwnerId) {if(f.codeOwnerId!==actor.id) deny('code_unavailable');return;}
      if(f.codeCancelled||f.courseStatus!=='published') deny('code_unavailable');
      if(f.activateBefore && now>=time(f.activateBefore)) deny('code_unavailable');return;
    case 'learning': learning();return;
    case 'watchLease': learning(); if(f.currentLeaseMatches!==true) deny('watch_transferred');return;
    case 'assessmentPreview':learning();if(f.assessmentCourseId!==f.courseId||f.assessmentPublished!==true) deny('content_unavailable');return;
    case 'startAttempt':
      learning();if(f.assessmentCourseId!==f.courseId||f.assessmentPublished!==true||!['exam','homework'].includes(f.attemptKind)) deny('content_unavailable');
      if(f.attemptKind==='exam') attemptLimit();
      if(f.attemptKind==='exam' && ((f.opensAt&&now<time(f.opensAt))||(f.closesAt&&now>=time(f.closesAt))
        ||f.attemptsUsed>=f.maxAttempts)) deny('attempt_unavailable'); return;
    case 'ongoingAttempt': ongoing();return;
    case 'submitAttempt': own();if(f.attempt.status==='submitted') return;ongoing();return;
    case 'finalResult': own();if(f.attempt.status!=='submitted') deny('result_unavailable');return;
    case 'examModel':
      own();if(f.attempt.status!=='submitted'||f.attempt.kind!=='exam') deny('model_unavailable');
      if(!f.closesAt) attemptLimit();
      if(f.closesAt ? now<time(f.closesAt) : f.attemptsUsed<f.maxAttempts) deny('model_unavailable');return;
    case 'admin': return;
    case 'reason':reason();return;
    case 'studentTarget':studentTarget();return;
    case 'studentReason':studentTarget();reason();return;
    case 'withdraw':studentTarget();reason();if(!f.access) deny('access_required');return;
    case 'extend':studentTarget();reason();if(!f.access||f.access.withdrawn_at) deny('access_required');
      if(!Number.isSafeInteger(input.days)||input.days<=0) deny('invalid_days');return;
    case 'unusedDraft':if(!f||[f.lessonPublished,f.firstUsed,f.hasReferences].some(v=>typeof v!=='boolean')) deny('resource_not_found');
      if(f.lessonPublished||f.firstUsed||f.hasReferences) deny('used_lesson');return;
    case 'dueAttempt':if(f?.attempt?.status!=='in_progress'||!f.attempt.deadline_at||now<time(f.attempt.deadline_at)) deny('not_due');return;
    case 'currentUpload':if(f?.providerVerified!==true||!Number.isSafeInteger(f.uploadGeneration)||f.uploadGeneration<1||f.uploadGeneration!==f.currentGeneration) deny('upload_event_rejected');return;
    default:deny('operation_denied');
  }
}

// All adapters are trusted server dependencies. loadResource never receives role/owner facts from a body.
// Run inside the command's F03 transaction; this is an eligibility guard, not a mutation itself.
export function createAuthorizer({resolveSession,loadAccount,loadResource,clock}) {
  return async function authorize(operation,credential,input={}) {
    const rule=Object.hasOwn(operations,operation)?operations[operation]:null;if(!rule||['internal','auth'].includes(rule.audience)) deny('operation_denied');
    let actor={id:null,role:'public'};
    if(rule.audience!=='public') {
      const session=await resolveSession(credential);if(!session) deny('login_required');
      const a=await loadAccount(session.accountId);if(!a) deny('login_required');
      if(String(a.auth_epoch)!==String(session.authEpoch)) deny('session_expired');
      if(a.status!=='active'||a.provisioning_locked||a.recovery_locked) deny('account_unavailable');
      if(a.role!==rule.audience) deny('role_denied');
      actor={id:a.id,role:a.role,authEpoch:a.auth_epoch};
    }
    const facts=await loadResource(operation,actor.id,input);
    const instant=await clock();
    // Preserve microsecond boundaries; final clock/state decision is still inside the command transaction.
    guardResource(rule.guard,facts,actor,input,time(instant));
    return Object.freeze({operation,actorId:actor.id,role:actor.role,scopeStudentId:actor.role==='student'?actor.id:null});
  };
}
// Only worker/provider handlers receive this closure; browser routes use createAuthorizer above.
export function createInternalAuthorizer({allowedOperations,clock}) {
  const allowed=new Set(allowedOperations);
  return async (operation,facts)=>{
    const rule=operations[operation];if(!allowed.has(operation)||rule?.audience!=='internal') deny('operation_denied');
    guardResource(rule.guard,facts,{id:null,role:'internal'},{},time(await clock()));
    return Object.freeze({operation,role:'internal'});
  };
}
