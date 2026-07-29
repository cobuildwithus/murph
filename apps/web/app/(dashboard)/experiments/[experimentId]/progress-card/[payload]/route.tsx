export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response("URL-encoded experiment progress cards are no longer available.", {
    headers: { "Cache-Control": "private, no-store" },
    status: 410,
  });
}
