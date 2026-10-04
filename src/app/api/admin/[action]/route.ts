import { NextResponse } from "next/server";
import { requestToken } from "@/server/auth/service";
import { catalogActions, catalogCommand } from "@/server/catalog/admin";
import { requestBody, errorResponse, privateHeaders } from "@/server/core/http";
import { denied } from "@/server/core/errors";
import { codeActions, adminCodeCommand } from "@/server/enrollments/codes";
import {
  studentActions,
  studentAdminCommand,
} from "@/server/auth/admin-students";
import { recoveryActions, recoveryAdminCommand } from "@/server/auth/recovery";
import { deleteActions, deleteCommand } from "@/server/catalog/deletion";
import {
  assessmentActions,
  assessmentCommand,
} from "@/server/assessments/admin";
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
      ...deleteActions,
    };
    if (!Object.hasOwn(actions, action))
      denied(404, "not_found", "العملية غير موجودة.");
    const body = await requestBody(request, actions[action]);
    const token = await requestToken();
    const result = Object.hasOwn(deleteActions, action)
      ? await deleteCommand(action, body, token)
      : Object.hasOwn(recoveryActions, action)
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
