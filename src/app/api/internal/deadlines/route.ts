import { handleDeadlineJob } from "@/server/jobs/deadlines";

export const runtime = "nodejs";
// A platform hint; actual wall-clock limits must be verified after deployment.
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleDeadlineJob(request);
}
