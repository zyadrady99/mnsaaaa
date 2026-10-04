import { NextResponse } from "next/server";
import { startAttempt } from "@/server/assessments/service";
import { requestToken } from "@/server/auth/service";
import { errorResponse, requestBody, privateHeaders } from "@/server/core/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await startAttempt(
        await requestBody(request, ["assessmentId", "versionId"]),
        await requestToken(),
      ),
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
