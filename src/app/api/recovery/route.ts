import { NextResponse } from "next/server";
import { recoverPassword } from "@/server/recovery";
import { errorResponse, privateHeaders, requestBody } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return NextResponse.json(
      await recoverPassword(await requestBody(request, ["code", "password"])),
      { headers: { ...privateHeaders, "Referrer-Policy": "no-referrer" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
