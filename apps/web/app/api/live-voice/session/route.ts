// This prototype is local-only. Public use needs member admission and usage limits.
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };
const reply = (error: string, status: number) => Response.json({ error }, { status, headers });

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (process.env.NODE_ENV !== "development" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    return reply("This voice preview is available on localhost only.", 404);
  }
  if (request.headers.get("origin") !== url.origin) return reply("Unexpected request origin.", 403);
  if (!process.env.OPENAI_API_KEY) return reply("Add OPENAI_API_KEY to the server environment, then restart the preview.", 503);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply("Expected JSON.", 415);

  const offer = await readOffer(request);
  if (offer instanceof Response) return offer;
  const sdp = offer;

  try {
    const response = await fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        session: {
          model: "gpt-live-1",
          store: false,
          instructions: "You are a friendly voice assistant in a local demo. Keep replies brief and natural. You have no access to personal records or app actions. Delegate questions requiring reasoning to the backend.",
          delegation: {
            type: "responses",
            responses: {
              model: "gpt-5.6-terra",
              instructions: "Answer briefly for a spoken conversation. You have no tools or access to personal records. Be clear about uncertainty.",
            },
          },
        },
        transport: { type: "webrtc", sdp },
      }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        return reply("The server's OpenAI key needs access to GPT-Live (gpt-live-1).", 502);
      }
      if (response.status === 429) return reply("OpenAI usage limit reached. Check the project's billing or try again shortly.", 429);
      return reply("OpenAI could not start the conversation. Please try again.", 502);
    }
    const result = await response.json();
    if (typeof result.transport?.sdp !== "string") return reply("OpenAI returned an incomplete connection answer.", 502);
    return Response.json({ sdp: result.transport.sdp }, { status: 201, headers });
  } catch {
    return reply("Could not reach OpenAI. Check your connection and try again.", 502);
  }
}

async function readOffer(request: Request): Promise<string | Response> {
  try {
    const raw = await request.text();
    if (raw.length > 65_536) return reply("Connection offer is too large.", 413);
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || !("sdp" in body) || typeof body.sdp !== "string" || !body.sdp.startsWith("v=0")) {
      return reply("A valid connection offer is required.", 400);
    }
    return body.sdp;
  } catch {
    return reply("A valid connection offer is required.", 400);
  }
}
