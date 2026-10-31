import { fileURLToPath } from "node:url";
import { buildPublicRoutesWafConfigUrl } from "./check-public-routes-waf.ts";
import { evaluateMachineRouteFirewall, isRecord } from "./vercel-machine-route-firewall.ts";
import { readProtectedMachineRoutes } from "./vercel-machine-routes.ts";

async function readJson(url: string, token: string, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new Error("Vercel firewall check: API request failed."); }
  if (!response.ok) throw new Error(`Vercel firewall check: API returned HTTP ${response.status}.`);
  try { return await response.json(); }
  catch { throw new Error("Vercel firewall check: invalid JSON response."); }
}

export async function checkVercelMachineRoutes(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: typeof fetch = fetch,
  log: (line: string) => void = console.log,
): Promise<void> {
  const required = (key: string) => {
    const value = environment[key]?.trim();
    if (!value) throw new Error(`Vercel firewall check: missing ${key}.`);
    return value;
  };
  const token = required("HOSTED_WEB_VERCEL_TOKEN");
  const projectId = required("HOSTED_WEB_VERCEL_PROJECT_ID");
  const teamId = required("HOSTED_WEB_VERCEL_TEAM_ID");
  const routes = await readProtectedMachineRoutes();
  const projectUrl = new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}`);
  projectUrl.searchParams.set("teamId", teamId);
  const [config, project] = await Promise.all([
    readJson(buildPublicRoutesWafConfigUrl(projectId, teamId), token, fetchImpl),
    readJson(projectUrl.toString(), token, fetchImpl),
  ]);
  if (!isRecord(config) || !isRecord(project) || !isRecord(project.security)) {
    throw new Error("Vercel firewall check: missing firewall or project security configuration.");
  }
  // Attack mode lives on project.security, outside the versioned WAF config.
  // Vercel CLI treats an omitted attackModeEnabled as false. Enabled barriers
  // stay red until removed; we do not locally infer expiry or bypass coverage.
  const conflicts = evaluateMachineRouteFirewall({
    ...config,
    attackModeEnabled: project.security.attackModeEnabled ?? false,
  }, routes);
  // API-derived ids keep a fixed alphabet so no newline or `##[` workflow command can form.
  const safe = (value: string) => value.replace(/[^\w:./[\]-]/gu, "?");
  for (const conflict of conflicts) {
    log(`Firewall conflict: rule=${safe(conflict.ruleId)} route=${safe(conflict.route)}`);
  }
  if (conflicts.length > 0) throw new Error(`Vercel firewall check: ${conflicts.length} machine-route conflicts.`);
  log(`Vercel firewall check passed: ${routes.length} protected routes; zero conflicts.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkVercelMachineRoutes().catch((error: unknown) => {
    // Only fixed API diagnostics escape the credential boundary above.
    console.error(error instanceof Error ? error.message : "Vercel firewall check failed.");
    process.exitCode = 1;
  });
}
