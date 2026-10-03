import { cookies } from "next/headers";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { identity, requestToken } from "@/server/auth";
import { transaction } from "@/server/db";
import { learningContext, validateWatch, watchCookie } from "@/server/learning";
import { errorResponse, privateHeaders } from "@/server/http";
import { uuid } from "@/server/admin-catalog";
import { denied } from "@/server/errors";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = uuid((await params).id),
      token = await requestToken(),
      watch = (await cookies()).get(watchCookie)?.value ?? "",
      generation = new URL(request.url).searchParams.get("generation");
    const ref = await transaction(async (db) => {
      const actor = await identity(db, token, "student", true);
      const { lesson } = await learningContext(db, actor.id, id);
      await validateWatch(db, actor.id, token, watch, id, generation);
      return lesson.local_fixture_ref as string;
    });
    if (ref !== "sample.mp4" || process.env.DOROSNA_LOCAL_ONLY !== "1")
      denied(409, "video_unavailable", "الفيديو غير متاح حاليًا.");
    const file = path.join(process.cwd(), ".local/media", ref),
      info = await stat(file),
      range = request.headers.get("range");
    let start = 0,
      end = info.size - 1,
      status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (match[1] === "" && match[2] === ""))
        return new Response(null, {
          status: 416,
          headers: {
            ...privateHeaders,
            "Content-Range": `bytes */${info.size}`,
          },
        });
      if (match[1] === "") {
        if (Number(match[2]) === 0)
          return new Response(null, {
            status: 416,
            headers: {
              ...privateHeaders,
              "Content-Range": `bytes */${info.size}`,
            },
          });
        start = Math.max(0, info.size - Number(match[2]));
      } else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= info.size
      )
        return new Response(null, {
          status: 416,
          headers: {
            ...privateHeaders,
            "Content-Range": `bytes */${info.size}`,
          },
        });
      status = 206;
    }
    const stream = Readable.toWeb(
      createReadStream(file, { start, end }),
    ) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      status,
      headers: {
        ...privateHeaders,
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        ...(status === 206
          ? { "Content-Range": `bytes ${start}-${end}/${info.size}` }
          : {}),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
