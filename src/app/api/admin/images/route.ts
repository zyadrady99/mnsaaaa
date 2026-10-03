import { NextResponse } from "next/server";
import { requestToken } from "@/server/auth";
import { uploadImage } from "@/server/media";
import { checkOrigin, errorResponse, privateHeaders } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    return NextResponse.json(await uploadImage(request, await requestToken()), {
      status: 201,
      headers: privateHeaders,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
