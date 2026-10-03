import { NextResponse } from "next/server";
import { requestToken } from "@/server/auth";
import { catalogActions, catalogCommand } from "@/server/admin-catalog";
import { requestBody, errorResponse, privateHeaders } from "@/server/http";
import { denied } from "@/server/errors";
import { codeActions, adminCodeCommand } from "@/server/codes";
import { studentActions, studentAdminCommand } from "@/server/admin-students";
import { recoveryActions, recoveryAdminCommand } from "@/server/recovery";
import {
  assessmentActions,
  assessmentCommand,
} from "@/server/admin-assessments";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { action } = await params;
    const actions = {
      ...catalogActions,
      ...assessmentActions,
      ...codeActions,
      ...studentActions,
      ...recoveryActions,
    };
    if (!Object.hasOwn(actions, action))
      denied(404, "not_found", "العملية غير موجودة.");
    const body = await requestBody(request, actions[action]);
    const token = await requestToken();
    const result = Object.hasOwn(recoveryActions, action)
      ? await recoveryAdminCommand(action, body, token)
      : Object.hasOwn(studentActions, action)
        ? await studentAdminCommand(action, body, token)
        : Object.hasOwn(codeActions, action)
          ? await adminCodeCommand(action, body, token)
          : Object.hasOwn(assessmentActions, action)
            ? await assessmentCommand(action, body, token)
            : await catalogCommand(action, body, token);
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
