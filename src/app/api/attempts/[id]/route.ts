import { NextResponse } from "next/server";
import { readAttempt } from "@/server/assessments";
import { requestToken } from "@/server/auth";
import { errorResponse, privateHeaders } from "@/server/http";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(
      await readAttempt((await params).id, await requestToken()),
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
