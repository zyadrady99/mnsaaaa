import { NextResponse } from "next/server";
import { studentCodeCommand } from "@/server/enrollments/codes";
import { requestToken } from "@/server/auth/service";
import { errorResponse, privateHeaders, requestBody } from "@/server/core/http";
import { denied } from "@/server/core/errors";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { action } = await params;
    if (action !== "preview" && action !== "activate")
      denied(404, "not_found", "العملية غير موجودة.");
    const body = await requestBody(
      request,
      action === "preview" ? ["code"] : ["code", "courseId"],
    );
    return NextResponse.json(
      await studentCodeCommand(action, body, await requestToken()),
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
