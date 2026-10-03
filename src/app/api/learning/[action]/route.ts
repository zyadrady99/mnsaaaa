import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { learningCommand, watchCookie, watchSeconds } from "@/server/learning";
import { requestToken } from "@/server/auth";
import { requestBody, errorResponse, privateHeaders } from "@/server/http";
import { denied } from "@/server/errors";
export const runtime = "nodejs";
const fields: Record<string, string[]> = {
  "video-open": ["lessonId", "transfer"],
  heartbeat: ["lessonId", "generation"],
  position: ["lessonId", "generation", "seconds", "revision"],
  complete: ["lessonId"],
};
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { action } = await params;
    if (!Object.hasOwn(fields, action))
      denied(404, "not_found", "العملية غير موجودة.");
    const result = await learningCommand(
      action,
      await requestBody(request, fields[action]),
      await requestToken(),
      (await cookies()).get(watchCookie)?.value ?? "",
    );
    if ("watchToken" in result && typeof result.watchToken === "string") {
      const response = NextResponse.json(
        {
          generation: result.generation,
          durationSeconds: result.durationSeconds,
          positionSeconds: result.positionSeconds,
          revision: result.revision,
        },
        { headers: privateHeaders },
      );
      response.cookies.set(watchCookie, result.watchToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.APP_ORIGIN?.startsWith("https://") ?? false,
        path: "/api",
        maxAge: watchSeconds,
      });
      return response;
    }
    const response = NextResponse.json(result, { headers: privateHeaders });
    if (action === "heartbeat") {
      const token = (await cookies()).get(watchCookie)?.value;
      if (token)
        response.cookies.set(watchCookie, token, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.APP_ORIGIN?.startsWith("https://") ?? false,
          path: "/api",
          maxAge: watchSeconds,
        });
    }
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
