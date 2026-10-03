import "server-only";
import { stat } from "node:fs/promises";
import path from "node:path";
import { transaction } from "./db";
export async function processLocalVideos() {
  if (process.env.DOROSNA_LOCAL_ONLY !== "1") return;
  let fixtureExists = false;
  try {
    fixtureExists =
      (await stat(path.join(process.cwd(), ".local/media/sample.mp4"))).size >
      0;
  } catch {}
  return transaction(async (db) => {
    // Only the current generation of an unused development lesson can become ready.
    // A replaced callback cannot publish an old generation or change used content.
    const rows = (
      await db.query(
        "select v.id,v.local_fixture_ref from app_private.courses c join app_private.lessons l on l.course_id=c.id join app_private.video_uploads v on v.id=l.current_video_id where c.delivery_environment='development' and l.published_at is null and l.first_used_at is null and v.provider='local' and v.verification='fixture' and v.state='processing' and v.created_at<clock_timestamp()-interval '3 seconds' order by c.id,l.id for update of c,l,v skip locked limit 20",
      )
    ).rows;
    for (const row of rows) {
      const ready = fixtureExists && row.local_fixture_ref === "sample.mp4";
      await db.query(
        "update app_private.video_uploads set state=$2,duration_seconds=$3,failure_code=$4 where id=$1 and state='processing'",
        [
          row.id,
          ready ? "ready" : "failed",
          ready ? 20 : null,
          ready
            ? null
            : fixtureExists
              ? "fixture_test_failure"
              : "fixture_missing",
        ],
      );
    }
    return rows.length;
  });
}
