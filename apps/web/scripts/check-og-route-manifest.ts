import { readdirSync } from "node:fs";
import path from "node:path";

export type AppPathRoutesManifest = Record<string, string>;

export function collectExpectedOgImageRoutes(appRoot: string): Array<{
  route: string;
  source: string;
}> {
  return collectOgImageFiles(appRoot).map((source) => {
    const relativeDirectory = path.relative(appRoot, path.dirname(source));
    const routeSegments = relativeDirectory
      .split(path.sep)
      .filter((segment) => segment.length > 0 && !isRouteGroup(segment));
    return {
      route: `/${[...routeSegments, "opengraph-image"].join("/")}`,
      source: path.relative(appRoot, source).replaceAll(path.sep, "/"),
    };
  });
}

export function assertUnhashedOgImageRoutes(
  appRoot: string,
  manifest: AppPathRoutesManifest,
): void {
  const emittedRoutes = new Set(Object.values(manifest));
  const missing = collectExpectedOgImageRoutes(appRoot).filter(
    ({ route }) => !emittedRoutes.has(route),
  );

  if (missing.length === 0) return;

  throw new Error([
    "OG image routes are missing their exact unhashed public paths in app-path-routes-manifest.json.",
    "Next metadata images inside route groups may emit hash-suffixed routes that do not match the URLs advertised by page metadata.",
    ...missing.map(({ route, source }) => `- ${route} <- app/${source}`),
  ].join("\n"));
}

function collectOgImageFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectOgImageFiles(absolutePath));
    } else if (entry.isFile() && entry.name === "opengraph-image.tsx") {
      files.push(absolutePath);
    }
  }
  return files.sort();
}

function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}
