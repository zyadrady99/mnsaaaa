import "server-only";
import { AppError } from "./errors";
type ProviderUser = {
  id: string;
  phone: string;
  phone_confirmed_at?: string;
  app_metadata?: Record<string, unknown>;
};
type ProviderResponse = {
  id?: string;
  phone?: string;
  phone_confirmed_at?: string;
  app_metadata?: Record<string, unknown>;
  user?: ProviderUser;
  access_token?: string;
  error_code?: string;
};

export async function provider(
  method: string,
  route: string,
  body?: unknown,
  accessToken?: string,
) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVER_KEY;
  if (
    !url ||
    !key ||
    (process.env.DOROSNA_LOCAL_ONLY === "1" && url !== "http://127.0.0.1:54321")
  )
    throw new AppError(
      503,
      "auth_unavailable",
      "خدمة الحسابات مش جاهزة حاليًا. جرّب تاني بعد لحظات.",
    );
  try {
    const response = await fetch(`${url}/auth/v1${route}`, {
      method,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        apikey: key,
        Authorization: `Bearer ${accessToken ?? key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await response.text();
    const data = raw ? (JSON.parse(raw) as ProviderResponse) : null;
    return { ok: response.ok, status: response.status, data };
  } catch {
    // Provider bodies, tokens and submitted passwords must never enter logs or responses.
    throw new AppError(
      503,
      "auth_unavailable",
      "تعذر التواصل مع خدمة الحسابات. جرّب تاني بعد لحظات.",
    );
  }
}
