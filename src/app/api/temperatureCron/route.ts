import type { NextRequest } from "next/server";
import { runOnOffJob } from "~/server/onoff";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const actionParam = request.nextUrl.searchParams.get("action");
  const forcedAction =
    actionParam === "on" || actionParam === "off" ? actionParam : undefined;

  const testTimeParam = request.nextUrl.searchParams.get("testTime");
  const now = testTimeParam
    ? new Date(Number(testTimeParam) * 1000)
    : new Date();

  try {
    const result = await runOnOffJob({
      action: forcedAction,
      now,
    });

    return Response.json({
      success: true,
      ranFor: result.ranFor,
      onCount: result.onCount,
      offCount: result.offCount,
      skippedCount: result.skippedCount,
      forcedAction: forcedAction ?? null,
    });
  } catch (error) {
    console.error("Error running on/off cron job:", error);
    return new Response("Internal server error", { status: 500 });
  }
}
