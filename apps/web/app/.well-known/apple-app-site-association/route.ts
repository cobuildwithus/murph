// The body depends on the requested host, so this can't be prerendered.
export const dynamic = "force-dynamic";

/**
 * www claims only recaps: the App Store build also claims www and sends every
 * universal link to its Telegram handler, so invites there stay Web links.
 * Invite links live on the `play.` host, which only builds that open invites
 * claim; every other app falls back to the same `/g/<token>` page there.
 */
export function GET(request: Request) {
  const host = (request.headers.get("host") ?? new URL(request.url).host).toLowerCase();
  return Response.json({
    applinks: {
      details: [{
        appIDs: ["G9DJH2XUMK.ai.withmurph.app"],
        components: [{ "/": host.startsWith("play.") ? "/g/*" : "/recap/*" }],
      }],
    },
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
