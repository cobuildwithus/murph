export const dynamic = "force-static";
export const revalidate = 3600;

export function GET() {
  return Response.json({
    applinks: {
      details: [{
        appIDs: ["G9DJH2XUMK.ai.withmurph.app"],
        components: [{ "/": "/recap/*" }, { "/": "/g/*" }],
      }],
    },
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
