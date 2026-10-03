import { NextResponse } from "next/server";
import { startAttempt } from "@/server/assessments";
import { requestToken } from "@/server/auth";
import { errorResponse, requestBody, privateHeaders } from "@/server/http";
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
