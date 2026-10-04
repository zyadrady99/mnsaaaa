import { NextResponse } from "next/server";
import { readResult } from "@/server/assessments/service";
import { requestToken } from "@/server/auth/service";
import { errorResponse, privateHeaders } from "@/server/core/http";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json(
      await readResult((await params).id, await requestToken()),
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
