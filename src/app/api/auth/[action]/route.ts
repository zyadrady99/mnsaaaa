import { NextResponse } from "next/server";
import {
  login,
  logout,
  register,
  requestToken,
  sessionCookie,
  sessionSeconds,
} from "@/server/auth";
import { errorResponse, privateHeaders, requestBody } from "@/server/http";
import { courseReturnTo } from "@/lib/return-to";
import { denied } from "@/server/errors";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { action } = await params;
    if (!["register", "login", "logout"].includes(action))
      denied(404, "not_found", "العملية غير موجودة.");
    const allowed =
      action === "register"
        ? ["name", "grade", "phone", "password", "requestId"]
        : action === "login"
          ? ["phone", "password", "next"]
          : [];
    const body = await requestBody(request, allowed);
    if (action === "register")
      return NextResponse.json(await register(body), {
        status: 201,
        headers: privateHeaders,
      });
    const response = NextResponse.json(
      action === "login" ? { signedIn: true } : { signedOut: true },
      { headers: privateHeaders },
    );
    const secure = process.env.APP_ORIGIN?.startsWith("https://") ?? false;
    if (action === "login") {
      const signed = await login(body);
      const next =
        signed.role === "admin"
          ? "/admin"
          : (courseReturnTo(
              typeof body.next === "string" ? body.next : undefined,
            ) ?? "/my-courses");
      const loggedIn = NextResponse.json(
        { signedIn: true, next },
        { headers: privateHeaders },
      );
      loggedIn.cookies.set(sessionCookie, signed.token, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: sessionSeconds,
      });
      return loggedIn;
    }
    await logout(await requestToken());
    response.cookies.set(sessionCookie, "", {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
