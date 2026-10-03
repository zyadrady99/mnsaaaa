import "server-only";
import { NextResponse } from "next/server";
import { AppError, denied } from "./errors";

export const privateHeaders = { "Cache-Control": "no-store, private" };
export function checkOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN;
  if (!expected || request.headers.get("origin") !== expected)
    denied(403, "origin_denied", "افتح الموقع من عنوانه المحلي وأعد المحاولة.");
}
export async function requestBody(request: Request, allowed?: string[]) {
  checkOrigin(request);
  if (
    !(request.headers.get("content-type") ?? "").startsWith("application/json")
  )
    denied(400, "invalid_body", "صيغة الطلب غير صحيحة.");
  const reader = request.body?.getReader();
  if (!reader) denied(400, "invalid_body", "الطلب فارغ.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 262144) {
      await reader.cancel();
      denied(413, "body_too_large", "البيانات كبيرة زيادة.");
    }
    chunks.push(value);
  }
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    denied(400, "invalid_body", "راجع البيانات وحاول تاني.");
  }
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    (allowed && Object.keys(data).some((key) => !allowed.includes(key)))
  )
    denied(400, "invalid_body", "راجع البيانات وحاول تاني.");
  return data as Record<string, unknown>;
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError)
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status: error.status, headers: privateHeaders },
    );
  // Log a bounded internal code only; never log SQL parameters, Auth bodies or passwords.
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "unexpected";
  if (code === "23505")
    return NextResponse.json(
      {
        error: "already_exists",
        message:
          "الرابط أو العنصر موجود بالفعل. اختار رابطًا مختلفًا أو عدّل العنصر الموجود.",
      },
      { status: 409, headers: privateHeaders },
    );
  if (code === "23514" || code === "23503")
    return NextResponse.json(
      {
        error: "state_conflict",
        message:
          "التغيير غير متاح للحالة الحالية. راجع المحتوى الجاهز والعناصر المرتبطة.",
      },
      { status: 409, headers: privateHeaders },
    );
  if (["40001", "40P01", "55P03"].includes(code))
    return NextResponse.json(
      {
        error: "operation_busy",
        message: "في عملية تانية بتتم على البيانات. جرّب تاني بعد لحظات.",
      },
      { status: 409, headers: privateHeaders },
    );
  console.error(
    "Dorosna operation failed:",
    /^[a-zA-Z0-9_]{1,40}$/.test(code) ? code : "unexpected",
  );
  return NextResponse.json(
    {
      error: "unavailable",
      message: "تعذر إتمام العملية. جرّب تاني بعد لحظات.",
    },
    { status: 503, headers: privateHeaders },
  );
}
