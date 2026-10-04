import { exportCodes } from "@/server/enrollments/codes";
import { requestToken } from "@/server/auth/service";
import { errorResponse, privateHeaders } from "@/server/core/http";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return new Response(await exportCodes(id, await requestToken()), {
      headers: {
        ...privateHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="dorosna-codes-${id}.csv"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
