import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { HOSTED_MACHINE_ROUTE_PREFIX } from "@murphai/hosted-execution/routes";

export interface ProtectedRoute {
  path: string;
  methods: readonly string[];
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const WEB_ROOT = fileURLToPath(new URL("../", import.meta.url));

// Provider ingress without an internal prefix. Route files remain the inventory.
const PROVIDER_PREFIXES = [
  "/api/hosted-onboarding/linq/webhook",
  "/api/hosted-onboarding/telegram/webhook",
  "/api/hosted-onboarding/stripe/webhook",
  "/api/retell/webhook",
  "/api/retell/functions",
  "/api/device-sync/webhooks",
];

export const BROWSER_CALLBACK_ROUTES = [
  "/api/clinical-records/oauth/callback",
  "/api/device-sync/connect/[provider]/callback",
  "/api/device-sync/oauth/[provider]/callback",
];

export function routeMethods(source: string): string[] {
  const names = new Set<string>();
  for (const node of parse(source, { sourceType: "module", plugins: ["typescript"] }).program.body) {
    if (node.type === "ExportAllDeclaration") return HTTP_METHODS;
    if (node.type !== "ExportNamedDeclaration" || node.exportKind === "type") continue;
    const declaration = node.declaration;
    if (declaration?.type === "FunctionDeclaration" && declaration.id) names.add(declaration.id.name);
    if (declaration?.type === "VariableDeclaration") {
      for (const item of declaration.declarations) {
        if (item.id.type === "Identifier") names.add(item.id.name);
      }
    }
    for (const specifier of node.specifiers) {
      names.add(specifier.exported.type === "Identifier" ? specifier.exported.name : specifier.exported.value);
    }
  }
  const methods = HTTP_METHODS.filter((method) => names.has(method));
  // Unknown export forms cannot silently narrow protection.
  if (methods.length === 0) return HTTP_METHODS;
  if (names.has("GET") && !names.has("HEAD")) methods.push("HEAD");
  if (!names.has("OPTIONS")) methods.push("OPTIONS");
  return methods;
}

export async function readWebRoutes(webRoot = WEB_ROOT): Promise<ProtectedRoute[]> {
  const appRoot = path.join(webRoot, "app");
  const files = await readdir(appRoot, { recursive: true });
  return Promise.all(files.filter((file) => file.endsWith("/route.ts")).sort().map(async (file) => ({
    path: "/" + file.split(path.sep).slice(0, -1)
      .filter((segment) => !segment.startsWith("(") && !segment.startsWith("@")).join("/"),
    methods: routeMethods(await readFile(path.join(appRoot, file), "utf8")),
  })));
}

export async function readProtectedMachineRoutes(webRoot = WEB_ROOT): Promise<ProtectedRoute[]> {
  const routes = await readWebRoutes(webRoot);
  const config: { crons: { path: string }[] } = JSON.parse(await readFile(path.join(webRoot, "vercel.json"), "utf8"));
  const cronPaths = new Set(config.crons.map((cron) => cron.path));
  for (const cron of cronPaths) {
    if (!routes.some((route) => route.path === cron && route.methods.includes("GET"))) {
      throw new Error("Vercel cron target has no GET route.");
    }
  }
  const protectedRoutes = routes.filter((route) => route.path.startsWith(HOSTED_MACHINE_ROUTE_PREFIX)
    || cronPaths.has(route.path)
    || PROVIDER_PREFIXES.some((prefix) => route.path === prefix || route.path.startsWith(`${prefix}/`)));
  if (protectedRoutes.length === 0) throw new Error("Machine route inventory is empty.");
  return protectedRoutes;
}
