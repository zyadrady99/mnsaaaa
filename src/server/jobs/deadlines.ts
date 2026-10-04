import "server-only";
import { timingSafeEqual } from "node:crypto";
import { runDueAttempts } from "@/server/assessments/service";

const privateHeaders = { "Cache-Control": "no-store, private" };
function failure(error: string, status: number, allowPost = false) {
  return Response.json(
    { error },
    {
      status,
      headers: { ...privateHeaders, ...(allowPost ? { Allow: "POST" } : {}) },
    },
  );
}

export async function handleDeadlineJob(request: Request) {
  if (request.method !== "POST")
    return failure("method_not_allowed", 405, true);

  const expected = process.env.APP_JOB_SECRET;
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected))
    return failure("deadline_job_unavailable", 503);

  const supplied = /^Bearer ([a-f0-9]{64})$/i.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (
    !supplied ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return failure("job_access_denied", 403);

  try {
    // Fixed server batch; request bodies and query parameters cannot expand it.
    // Statement timeout bounds each query, not the complete invocation duration.
    const finalized = await runDueAttempts(1, 10_000);
    if (!Number.isInteger(finalized) || finalized < 0 || finalized > 1)
      return failure("deadline_job_unavailable", 503);
    return Response.json({ finalized }, { headers: privateHeaders });
  } catch {
    // DB errors, request tokens, and grading details never enter job responses/logs.
    return failure("deadline_job_unavailable", 503);
  }
}
