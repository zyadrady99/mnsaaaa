import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { PoolClient } from "pg";
import { validUuid } from "@/lib/auth-input";
import { identity } from "./auth";
import { database, transaction } from "./db";
import { denied } from "./errors";

const maxImageBytes = 5 * 1024 * 1024;
const maxRequestBytes = maxImageBytes + 64 * 1024;
const imageRoot = path.resolve(process.cwd(), ".local", "media", "images");
const staticImages = new Set([
  "/images/teacher-ahmed.svg",
  "/images/teacher-mariam.svg",
  "/images/teacher-omar.svg",
  "/images/teacher-youssef.svg",
  "/images/course-physics.svg",
  "/images/course-chemistry.svg",
  "/images/course-math.svg",
  "/images/course-arabic.svg",
]);

export async function validateImageRef(
  db: PoolClient,
  value: unknown,
  fallback: string,
) {
  const ref = value === undefined ? fallback : value;
  if (typeof ref !== "string")
    denied(400, "invalid_image", "اختار صورة من جهازك أو احذف الصورة الحالية.");
  if (ref === "" || staticImages.has(ref)) return ref;
  const id = ref.startsWith("/media/images/") ? ref.slice(14) : "";
  if (
    validUuid(id) &&
    (await db.query("select 1 from app_private.media_assets where id=$1", [id]))
      .rowCount
  )
    return ref;
  denied(400, "invalid_image", "الصورة غير موجودة. ارفعها من جهازك تاني.");
}

async function imageForm(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data;"))
    denied(400, "invalid_body", "اختار ملف صورة لرفعه.");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxRequestBytes)
    denied(413, "image_too_large", "حجم الصورة لازم يكون ٥ ميجابايت أو أقل.");
  const reader = request.body?.getReader();
  if (!reader) denied(400, "invalid_body", "اختار صورة أولًا.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxRequestBytes) {
      await reader.cancel();
      denied(413, "image_too_large", "حجم الصورة لازم يكون ٥ ميجابايت أو أقل.");
    }
    chunks.push(value);
  }
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: Buffer.concat(chunks),
    }).formData();
  } catch {
    denied(400, "invalid_body", "تعذر قراءة الصورة. اختار الملف تاني.");
  }
  if (
    [...form.keys()].some((key) => !["file", "kind"].includes(key)) ||
    form.getAll("file").length !== 1 ||
    form.getAll("kind").length !== 1
  )
    denied(400, "invalid_body", "بيانات الصورة غير صحيحة.");
  const file = form.get("file"),
    kind = form.get("kind");
  if (!(file instanceof File) || !["teacher", "course"].includes(String(kind)))
    denied(400, "invalid_image", "اختار صورة مدرس أو غلاف كورس.");
  if (!file.size || file.size > maxImageBytes)
    denied(
      413,
      "image_too_large",
      "اختار صورة غير فارغة، حجمها ٥ ميجابايت أو أقل.",
    );
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    denied(400, "invalid_image", "الصيغ المتاحة: JPG وPNG وWebP.");
  const input = Buffer.from(await file.arrayBuffer());
  const format = input.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    ? "jpeg"
    : input
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "png"
      : input.subarray(0, 4).toString() === "RIFF" &&
          input.subarray(8, 12).toString() === "WEBP"
        ? "webp"
        : "";
  if (!format || file.type !== `image/${format}`)
    denied(400, "invalid_image", "الملف مش صورة صالحة بالصيغ المتاحة.");
  try {
    const pipeline = sharp(input, {
      limitInputPixels: 16_000_000,
      failOn: "warning",
    });
    const metadata = await pipeline.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1)
      denied(400, "invalid_image", "اختار صورة ثابتة صالحة.");
    const output = await pipeline
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    if (output.data.length > maxImageBytes)
      denied(413, "image_too_large", "اختار صورة أقل في الحجم أو الأبعاد.");
    return { ...output, kind: String(kind) };
  } catch {
    denied(
      400,
      "invalid_image",
      "تعذر قراءة الصورة، أو أبعادها كبيرة جدًا. اختار JPG أو PNG أو WebP أقل من ١٦ مليون بكسل.",
    );
  }
}

export async function uploadImage(request: Request, token: string) {
  // Check the current admin session before accepting or decoding any upload.
  const db = await database().connect();
  try {
    await identity(db, token, "admin");
  } finally {
    db.release();
  }
  const output = await imageForm(request),
    id = randomUUID();
  const file = path.join(imageRoot, `${id}.webp`);
  let written = false;
  try {
    await transaction(async (db) => {
      const actor = await identity(db, token, "admin", true);
      await mkdir(imageRoot, { recursive: true });
      await writeFile(file, output.data, { flag: "wx" });
      written = true;
      await db.query(
        `insert into app_private.media_assets(id,kind,content_type,bytes,width,height,created_by) values($1,$2,'image/webp',$3,$4,$5,$6)`,
        [
          id,
          output.kind,
          output.data.length,
          output.info.width,
          output.info.height,
          actor.id,
        ],
      );
      await db.query(
        `insert into app_private.audit_events(actor_id,action,target_type,target_id,operation_id) values($1,'image-upload','media', $2,$3)`,
        [actor.id, id, randomUUID()],
      );
    });
  } catch (error) {
    if (written) await unlink(file).catch(() => {});
    throw error;
  }
  return {
    ref: `/media/images/${id}`,
    width: output.info.width,
    height: output.info.height,
    message: "الصورة اترفعت. احفظ البيانات علشان تظهر على المنصة.",
  };
}

export async function readImage(id: string) {
  if (!validUuid(id)) return null;
  const asset = (
    await database().query(
      "select bytes from app_private.media_assets where id=$1",
      [id],
    )
  ).rows[0];
  if (!asset) return null;
  try {
    return await readFile(path.join(imageRoot, `${id}.webp`));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}
