import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV =
  "MURPH_HEALTH_COMMONS_PACKAGE_ROOT";

export interface LoadGeneratedHealthCommonsWebArtifactOptions {
  generatedWebRoot?: string | URL;
}

export function defaultHealthCommonsPackageRootUrl(): URL {
  const envValue = process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV]?.trim();
  if (envValue) {
    return ensureTrailingSlashUrl(stringToFileOrUrl(envValue));
  }

  return ensureTrailingSlashUrl(pathToFileURL(resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
  )));
}

export function normalizeGeneratedWebRoot(
  value: string | URL | undefined,
): URL {
  const url = value
    ? typeof value === "string"
      ? stringToFileOrUrl(value)
      : value
    : defaultGeneratedWebRootUrl();
  assertLocalFileUrlWithoutComponents(url, "generated web root");
  return ensureTrailingSlashUrl(pathToFileURL(resolve(fileURLToPath(url))));
}

export function generatedWebArtifactUrl(
  artifactPath: string,
  generatedWebRoot: string | URL | undefined,
): URL {
  if (!isSafeGeneratedWebArtifactPath(artifactPath)) {
    throw new Error(`Unsafe Health Commons generated web artifact path: ${artifactPath}`);
  }

  const rootUrl = normalizeGeneratedWebRoot(generatedWebRoot);
  const rootPath = resolve(fileURLToPath(rootUrl));
  const artifactUrl = new URL(artifactPath, rootUrl);
  assertLocalFileUrlWithoutComponents(artifactUrl, "generated web artifact");

  const artifactFilePath = resolve(fileURLToPath(artifactUrl));
  assertContainedPath(rootPath, artifactFilePath);
  return pathToFileURL(artifactFilePath);
}

export function isSafeGeneratedWebArtifactPath(value: string): boolean {
  let decodedValue = value;
  for (let pass = 0; pass < 8; pass += 1) {
    if (!hasSafeArtifactPathSyntax(decodedValue)) {
      return false;
    }

    let nextValue: string;
    try {
      nextValue = decodeURIComponent(decodedValue);
    } catch {
      return false;
    }

    if (nextValue === decodedValue) {
      return true;
    }
    if (slashCount(nextValue) !== slashCount(decodedValue)) {
      return false;
    }
    decodedValue = nextValue;
  }

  return false;
}

export function readGeneratedWebArtifact(
  artifactPath: string,
  generatedWebRoot: string | URL | undefined,
): string {
  const rootUrl = normalizeGeneratedWebRoot(generatedWebRoot);
  const artifactUrl = generatedWebArtifactUrl(artifactPath, rootUrl);
  if (!existsSync(artifactUrl)) {
    return readFileSync(artifactUrl, "utf8");
  }

  const realRootPath = realpathSync(fileURLToPath(rootUrl));
  const realArtifactPath = realpathSync(fileURLToPath(artifactUrl));
  assertContainedPath(realRootPath, realArtifactPath);
  return readFileSync(realArtifactPath, "utf8");
}

function defaultGeneratedWebRootUrl(): URL {
  const envPackageRoot = process.env[MURPH_HEALTH_COMMONS_PACKAGE_ROOT_ENV]?.trim();
  if (envPackageRoot) {
    return ensureTrailingSlashUrl(
      new URL("generated/web", defaultHealthCommonsPackageRootUrl()),
    );
  }

  const runtimeSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const fallbackGeneratedWebRootUrl = pathToFileURL(resolve(
    process.cwd(),
    "packages/health-commons/generated/web",
  ));
  const candidateRootUrls = [
    fallbackGeneratedWebRootUrl,
    pathToFileURL(resolve(process.cwd(), "../packages/health-commons/generated/web")),
    pathToFileURL(resolve(process.cwd(), "../../packages/health-commons/generated/web")),
    pathToFileURL(resolve(runtimeSourceRoot, "generated/web")),
  ];

  for (const candidateRootUrl of candidateRootUrls) {
    const candidateRoot = candidateRootUrl.protocol === "file:"
      ? fileURLToPath(candidateRootUrl)
      : null;
    if (
      candidateRoot
      && (
        existsSync(resolve(candidateRoot, "routes/index.json"))
        || existsSync(resolve(candidateRoot, "browse/goals.json"))
      )
    ) {
      return ensureTrailingSlashUrl(candidateRootUrl);
    }
  }

  return ensureTrailingSlashUrl(fallbackGeneratedWebRootUrl);
}

function ensureTrailingSlashUrl(value: URL): URL {
  return value.href.endsWith("/") ? value : new URL(`${value.href}/`);
}

function assertContainedPath(rootPath: string, artifactPath: string): void {
  const relativePath = relative(rootPath, artifactPath);
  if (
    relativePath.length === 0
    || relativePath === ".."
    || relativePath.startsWith(`..${sep}`)
    || isAbsolute(relativePath)
  ) {
    throw new Error("Health Commons generated web artifact path is outside its generated root.");
  }
}

function assertLocalFileUrlWithoutComponents(value: URL, label: string): void {
  if (value.protocol !== "file:" || value.search.length > 0 || value.hash.length > 0) {
    throw new Error(`Health Commons ${label} must be a local file URL without query or hash components.`);
  }
}

function hasSafeArtifactPathSyntax(value: string): boolean {
  if (
    value.length === 0
    || /^[a-z][a-z\d+.-]*:/iu.test(value)
    || value.startsWith("/")
    || value.includes("\\")
    || value.includes("?")
    || value.includes("#")
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return false;
  }

  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function slashCount(value: string): number {
  return value.split("/").length - 1;
}

function stringToFileOrUrl(value: string): URL {
  if (/^[a-z][a-z\d+.-]*:/iu.test(value)) {
    return new URL(value);
  }

  return pathToFileURL(resolve(value));
}
