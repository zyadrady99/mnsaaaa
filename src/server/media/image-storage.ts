import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { validUuid } from "@/lib/auth-input";
import { AppError } from "@/server/core/errors";

export const maxImageUploadBytes = 4 * 1024 * 1024;
// Existing normalized assets were accepted up to 5 MiB before cloud readiness.
const maxStoredImageBytes = 5 * 1024 * 1024;

function unavailable(): never {
  throw new AppError(
    503,
    "image_storage_unavailable",
    "خدمة الصور مش متاحة حاليًا. جرّب تاني بعد لحظات.",
  );
}

function imageKey(id: string) {
  if (!validUuid(id))
    throw new AppError(400, "invalid_image", "الصورة غير صالحة.");
  return `${id.toLowerCase()}.webp`;
}

function localFile(key: string) {
  return path.resolve(process.cwd(), ".local", "media", "images", key);
}

function cloudConfig() {
  const bucket = process.env.SUPABASE_IMAGE_BUCKET;
  const key = process.env.SUPABASE_SERVER_KEY;
  const legacyJwt =
    !!key &&
    !key.startsWith("sb_") &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key);
  if (
    !bucket ||
    !/^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/.test(bucket) ||
    !key ||
    (!key.startsWith("sb_secret_") && !legacyJwt)
  )
    unavailable();

  let url: URL;
  try {
    url = new URL(process.env.SUPABASE_URL ?? "");
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      unavailable();
  } catch {
    unavailable();
  }
  return {
    origin: url.origin,
    bucket,
    headers: {
      apikey: key,
      ...(legacyJwt ? { Authorization: `Bearer ${key}` } : {}),
    },
  };
}

async function cloudRequest(
  method: "POST" | "GET" | "DELETE",
  key: string,
  bytes?: Buffer,
) {
  const config = cloudConfig();
  const prefix = method === "GET" ? "object/authenticated" : "object";
  try {
    return await fetch(
      `${config.origin}/storage/v1/${prefix}/${config.bucket}/${key}`,
      {
        method,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          ...config.headers,
          ...(method === "POST"
            ? {
                "Content-Type": "image/webp",
                "Content-Length": String(bytes!.length),
                "Cache-Control": "31536000",
                "x-upsert": "false",
              }
            : {}),
        },
        ...(bytes ? { body: new Uint8Array(bytes) } : {}),
      },
    );
  } catch {
    unavailable();
  }
}

async function discardBody(response: Response) {
  await response.body?.cancel().catch(() => {});
}

async function writeImageBlob(id: string, bytes: Buffer) {
  const key = imageKey(id);
  if (!bytes.length || bytes.length > maxImageUploadBytes) unavailable();
  if (process.env.DOROSNA_LOCAL_ONLY === "1") {
    try {
      const file = localFile(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: "wx" });
      return;
    } catch {
      unavailable();
    }
  }
  const response = await cloudRequest("POST", key, bytes);
  await discardBody(response);
  if (!response.ok) unavailable();
}

async function removeImageBlob(id: string) {
  const key = imageKey(id);
  if (process.env.DOROSNA_LOCAL_ONLY === "1") {
    try {
      await unlink(localFile(key));
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        unavailable();
    }
    return;
  }
  const response = await cloudRequest("DELETE", key);
  await discardBody(response);
  if (!response.ok && response.status !== 404) unavailable();
}

// The caller controls when the write occurs, after its locked authorization
// check. Cleanup covers a rejected DB commit without touching older assets.
export async function withImageWrite<T>(
  id: string,
  bytes: Buffer,
  persist: (write: () => Promise<void>) => Promise<T>,
) {
  let written = false;
  try {
    return await persist(async () => {
      if (written) unavailable();
      await writeImageBlob(id, bytes);
      written = true;
    });
  } catch (error) {
    if (written) await removeImageBlob(id).catch(() => {});
    throw error;
  }
}

export async function readImageBlob(id: string, expectedBytes: number) {
  const key = imageKey(id);
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes < 1 ||
    expectedBytes > maxStoredImageBytes
  )
    unavailable();
  let bytes: Buffer;
  if (process.env.DOROSNA_LOCAL_ONLY === "1") {
    try {
      bytes = await readFile(localFile(key));
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return null;
      unavailable();
    }
  } else {
    const response = await cloudRequest("GET", key);
    if (response.status === 404) {
      await discardBody(response);
      return null;
    }
    if (
      !response.ok ||
      response.headers.get("content-type")?.split(";")[0].trim() !==
        "image/webp" ||
      Number(response.headers.get("content-length") ?? 0) > expectedBytes
    ) {
      await discardBody(response);
      unavailable();
    }
    const reader = response.body?.getReader();
    if (!reader) unavailable();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > expectedBytes) {
          await reader.cancel().catch(() => {});
          unavailable();
        }
        chunks.push(value);
      }
    } catch {
      unavailable();
    }
    bytes = Buffer.concat(chunks);
  }
  if (
    bytes.length !== expectedBytes ||
    bytes.subarray(0, 4).toString() !== "RIFF" ||
    bytes.subarray(8, 12).toString() !== "WEBP"
  )
    unavailable();
  return bytes;
}
