import { NextResponse } from "next/server";
import { requestToken } from "@/server/auth/service";
import { uploadImage } from "@/server/media/images";
import { checkOrigin, errorResponse, privateHeaders } from "@/server/core/http";
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
