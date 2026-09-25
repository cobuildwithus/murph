import { readIOSMinimumBuild } from "@/src/lib/device-sync/app-update-policy";

export const dynamic = "force-dynamic";

// Public, constant-sized metadata. No identity, database or provider access.
export function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    return Response.json({ schemaVersion: 1, minimumIOSBuild: readIOSMinimumBuild() }, { headers });
  } catch {
    // Invalid operator configuration must not masquerade as a cleared floor.
    return Response.json({ error: "APP_POLICY_UNAVAILABLE" }, { status: 503, headers });
  }
}
