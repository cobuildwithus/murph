import { jsonOk } from "../../hosted-onboarding/http";
import { hasGameMultiplayer } from "./capability";

/** Full group history exceeds the host's buffered response limit. Stream the
 * same JSON bytes; collection limits and legacy pair responses stay intact. */
export function gameJsonOk(request: Request, payload: unknown, headers?: HeadersInit): Response {
  if (!hasGameMultiplayer(request)) return jsonOk(payload, 200, headers);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const end = Math.min(offset + 64 * 1024, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
      if (offset === bytes.length) controller.close();
    },
  });
  return new Response(body, { headers: {
    "Content-Type": "application/json", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
    ...Object.fromEntries(new Headers(headers)),
  } });
}
