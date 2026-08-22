import {
  MURPH_AGENT_CONTENT_VARY,
  MURPH_AGENT_GUIDE_MARKDOWN,
} from "@/src/lib/public-agent-content";

export const dynamic = "force-static";

export function GET() {
  return new Response(MURPH_AGENT_GUIDE_MARKDOWN, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: MURPH_AGENT_CONTENT_VARY,
    },
  });
}
