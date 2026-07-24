import { readHostedMessageVolumeTotal } from "@/src/lib/hosted-ops/growth-metrics";

const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

export async function GET(): Promise<Response> {
  return Response.json(
    { total: await readHostedMessageVolumeTotal(new Date()) },
    {
      headers: {
        "Cache-Control": CACHE_CONTROL,
      },
    },
  );
}
