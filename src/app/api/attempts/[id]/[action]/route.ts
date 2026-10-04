import { NextResponse } from "next/server";
import { attemptCommand } from "@/server/assessments/service";
import { requestToken } from "@/server/auth/service";
import { errorResponse, requestBody, privateHeaders } from "@/server/core/http";
import { denied } from "@/server/core/errors";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  try {
    const { id, action } = await params;
    if (action !== "answer" && action !== "submit")
      denied(404, "not_found", "العملية غير موجودة.");
    return NextResponse.json(
      await attemptCommand(
        action,
        id,
        await requestBody(
          request,
          action === "answer" ? ["questionId", "optionId", "revision"] : [],
        ),
        await requestToken(),
      ),
      { headers: privateHeaders },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
