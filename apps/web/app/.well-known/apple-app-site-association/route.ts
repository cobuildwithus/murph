export const dynamic = "force-static";
export const revalidate = 3600;

export function GET() {
  return Response.json({
    applinks: {
      details: [{
        appIDs: ["G9DJH2XUMK.ai.withmurph.app"],
        // "/connect/?*" is a source's link page: at least one character after
        // the slash. It never matches "/connect" or "/connect/", the website's
        // own connect page, which stays in the browser.
        components: [{ "/": "/recap/*" }, { "/": "/g/*" }, { "/": "/connect/?*" }],
      }],
    },
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  });
}
