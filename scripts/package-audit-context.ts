import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { getBlockedWorkingTreeArtifactPath } from "./check-no-js.js";

const execFileAsync = promisify(execFile);

type OutputFormat = "zip" | "txt" | "both";

type ScanSpec = {
  root: string;
  fileGlob: string;
};

type PackagingOptions = {
  format: OutputFormat;
  outDir?: string;
  prefix: string;
  title: string;
  repoLabel: string;
  includeTests: boolean;
  includeDocs: boolean;
  includeCi: boolean;
  alwaysPaths: string[];
  scanSpecs: ScanSpec[];
  testScanSpecs: ScanSpec[];
  docScanSpecs: ScanSpec[];
  ciScanSpecs: ScanSpec[];
};

type ManifestOptions = {
  visibleFiles: Iterable<string>;
  alwaysPaths: Iterable<string>;
  scanSpecs: ScanSpec[];
  testScanSpecs: ScanSpec[];
  docScanSpecs: ScanSpec[];
  ciScanSpecs: ScanSpec[];
  includeTests: boolean;
  includeDocs: boolean;
  includeCi: boolean;
};

function trimCr(value: string): string {
  return value.replace(/\r$/u, "");
}

function normalizePathForAudit(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/u, "").replace(/\/+$/u, "");
}

function splitEnvLines(value: string | undefined): string[] {
  return String(value ?? "")
    .split("\n")
    .map((entry) => trimCr(entry).trim())
    .filter((entry) => entry.length > 0);
}

function parseBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

export function parseScanSpec(rawSpec: string): ScanSpec {
  const normalized = trimCr(rawSpec).trim();
  if (normalized.length === 0) {
    throw new Error("Scan spec cannot be empty.");
  }

  const separatorIndex = normalized.indexOf(":");
  if (separatorIndex === -1) {
    return {
      root: normalizePathForAudit(normalized),
      fileGlob: "*",
    };
  }

  return {
    root: normalizePathForAudit(normalized.slice(0, separatorIndex)),
    fileGlob: normalized.slice(separatorIndex + 1) || "*",
  };
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "u");
}

function matchesScanSpec(relativePath: string, spec: ScanSpec): boolean {
  const normalizedPath = normalizePathForAudit(relativePath);
  const normalizedRoot = normalizePathForAudit(spec.root);
  const fileName = path.posix.basename(normalizedPath);
  const pattern = globToRegExp(spec.fileGlob);

  if (!pattern.test(fileName)) {
    return false;
  }

  if (normalizedPath === normalizedRoot) {
    return true;
  }

  return normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function getBlockedSourceBundleArtifactPath(relativePath: string): string | null {
  const normalizedPath = normalizePathForAudit(relativePath);
  if (normalizedPath.length === 0) {
    return null;
  }

  const blockedFilePath = getBlockedWorkingTreeArtifactPath(normalizedPath, "file");
  if (blockedFilePath) {
    return blockedFilePath;
  }

  const pathSegments = normalizedPath.split("/");
  let currentPath = "";
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    currentPath = currentPath ? `${currentPath}/${pathSegments[index]}` : pathSegments[index];
    const blockedDirectoryPath = getBlockedWorkingTreeArtifactPath(currentPath, "directory");
    if (blockedDirectoryPath) {
      return blockedDirectoryPath;
    }
  }

  return null;
}

export function buildAuditManifestPaths(options: ManifestOptions): string[] {
  const selectedPaths = new Set<string>();
  const alwaysPathSet = new Set(Array.from(options.alwaysPaths, normalizePathForAudit));
  const activeScanSpecs = [...options.scanSpecs];

  if (options.includeTests) {
    activeScanSpecs.push(...options.testScanSpecs);
  }
  if (options.includeDocs) {
    activeScanSpecs.push(...options.docScanSpecs);
  }
  if (options.includeCi) {
    activeScanSpecs.push(...options.ciScanSpecs);
  }

  for (const candidate of options.visibleFiles) {
    const normalizedPath = normalizePathForAudit(candidate);
    if (normalizedPath.length === 0 || getBlockedSourceBundleArtifactPath(normalizedPath)) {
      continue;
    }

    if (alwaysPathSet.has(normalizedPath)) {
      selectedPaths.add(normalizedPath);
      continue;
    }

    if (activeScanSpecs.some((scanSpec) => matchesScanSpec(normalizedPath, scanSpec))) {
      selectedPaths.add(normalizedPath);
    }
  }

  return [...selectedPaths].sort();
}

async function getRepoRoot(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function getGitVisibleFiles(repoRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  return stdout
    .split("\u0000")
    .map((entry) => normalizePathForAudit(entry))
    .filter((entry) => entry.length > 0);
}

async function createZip(repoRoot: string, zipPath: string, manifestPaths: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("zip", ["-q", zipPath, "-@"], {
      cwd: repoRoot,
      stdio: ["pipe", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `zip exited with code ${code ?? "unknown"}.`));
    });

    child.stdin.end(`${manifestPaths.join("\n")}\n`);
  });
}

async function writeMergedTextFile(
  repoRoot: string,
  txtPath: string,
  manifestPaths: string[],
  title: string,
  repoLabel: string,
): Promise<void> {
  const chunks = [
    `# ${title}`,
    `# Generated (UTC): ${new Date().toISOString().replace(/\.\d{3}Z$/u, "Z")}`,
    `# Repository: ${repoLabel}`,
    `# Files: ${manifestPaths.length}`,
  ];

  for (const relativePath of manifestPaths) {
    const absolutePath = path.join(repoRoot, relativePath);
    const contents = await readFile(absolutePath, "utf8");
    chunks.push(`\n===== FILE: ${relativePath} =====\n${contents}`);
  }

  await writeFile(txtPath, `${chunks.join("\n")}\n`, "utf8");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

function displayPath(targetPath: string): string {
  return normalizePathForAudit(path.resolve(targetPath));
}

function formatUtcBundleTimestamp(): string {
  const iso = new Date().toISOString();
  const [datePart, timeWithMillis] = iso.split("T");
  const timePart = timeWithMillis.replace(/\.\d{3}Z$/u, "Z");
  return `${datePart.replace(/-/g, "")}-${timePart.replace(/:/g, "")}`;
}

function printUsage(prefixDefault: string, repoLabel: string): void {
  console.error(`Usage: package-audit-context.ts [options]

Packages audit-relevant ${repoLabel} files into upload-friendly artifacts.

Options:
  --zip              Create only a .zip archive
  --txt              Create only a merged .txt file
  --both             Create both .zip and .txt (default)
  --out-dir <dir>    Output directory (default: <repo>/audit-packages)
  --name <prefix>    Output filename prefix (default: ${prefixDefault})
  --with-tests       Include configured test scan paths
  --no-tests         Exclude configured test scan paths
  --with-docs        Include configured docs scan paths
  --no-docs          Exclude configured docs scan paths
  --with-ci          Include configured CI scan paths
  --no-ci            Exclude configured CI scan paths
  -h, --help         Show this help message`);
}

function getDefaultOptionsFromEnv(): Omit<PackagingOptions, "format" | "outDir"> {
  const prefix = process.env.COBUILD_AUDIT_CONTEXT_PREFIX?.trim() || "cobuild-audit";
  const title = process.env.COBUILD_AUDIT_CONTEXT_TITLE?.trim() || "Cobuild Audit Bundle";
  const repoLabel = process.env.COBUILD_AUDIT_CONTEXT_REPO_LABEL?.trim() || "repo";

  return {
    prefix,
    title,
    repoLabel,
    includeTests: parseBooleanFlag(process.env.COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT, true),
    includeDocs: parseBooleanFlag(process.env.COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT, true),
    includeCi: parseBooleanFlag(process.env.COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT, true),
    alwaysPaths: splitEnvLines(process.env.COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS),
    scanSpecs: splitEnvLines(process.env.COBUILD_AUDIT_CONTEXT_SCAN_SPECS).map(parseScanSpec),
    testScanSpecs: splitEnvLines(process.env.COBUILD_AUDIT_CONTEXT_TEST_SCAN_SPECS).map(parseScanSpec),
    docScanSpecs: splitEnvLines(process.env.COBUILD_AUDIT_CONTEXT_DOC_SCAN_SPECS).map(parseScanSpec),
    ciScanSpecs: splitEnvLines(process.env.COBUILD_AUDIT_CONTEXT_CI_SCAN_SPECS).map(parseScanSpec),
  };
}

function parseArgs(argv: string[]): PackagingOptions {
  const defaults = getDefaultOptionsFromEnv();
  let format: OutputFormat = "both";
  let outDir: string | undefined;
  let includeTests = defaults.includeTests;
  let includeDocs = defaults.includeDocs;
  let includeCi = defaults.includeCi;
  let prefix = defaults.prefix;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--zip":
        format = "zip";
        break;
      case "--txt":
        format = "txt";
        break;
      case "--both":
        format = "both";
        break;
      case "--out-dir":
        if (index + 1 >= argv.length) {
          throw new Error("Error: --out-dir requires a value.");
        }
        outDir = argv[index + 1];
        index += 1;
        break;
      case "--name":
        if (index + 1 >= argv.length) {
          throw new Error("Error: --name requires a value.");
        }
        prefix = argv[index + 1];
        index += 1;
        break;
      case "--with-tests":
        includeTests = true;
        break;
      case "--no-tests":
        includeTests = false;
        break;
      case "--with-docs":
        includeDocs = true;
        break;
      case "--no-docs":
        includeDocs = false;
        break;
      case "--with-ci":
        includeCi = true;
        break;
      case "--no-ci":
        includeCi = false;
        break;
      case "-h":
      case "--help":
        printUsage(defaults.prefix, defaults.repoLabel);
        process.exit(0);
      default:
        throw new Error(`Error: unknown option '${argument}'.`);
    }
  }

  return {
    ...defaults,
    format,
    outDir,
    prefix,
    includeTests,
    includeDocs,
    includeCi,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const repoRoot = await getRepoRoot();

  const outputDirectory = options.outDir
    ? path.resolve(repoRoot, options.outDir)
    : path.join(repoRoot, "audit-packages");
  await mkdir(outputDirectory, { recursive: true });

  const visibleFiles = await getGitVisibleFiles(repoRoot);
  const manifestPaths = buildAuditManifestPaths({
    visibleFiles,
    alwaysPaths: options.alwaysPaths,
    scanSpecs: options.scanSpecs,
    testScanSpecs: options.testScanSpecs,
    docScanSpecs: options.docScanSpecs,
    ciScanSpecs: options.ciScanSpecs,
    includeTests: options.includeTests,
    includeDocs: options.includeDocs,
    includeCi: options.includeCi,
  });

  if (manifestPaths.length === 0) {
    throw new Error("Error: no files matched packaging filters.");
  }

  const timestamp = formatUtcBundleTimestamp();
  const baseName = `${options.prefix}-${timestamp}`;

  let zipPath: string | undefined;
  let txtPath: string | undefined;

  if (options.format === "zip" || options.format === "both") {
    zipPath = path.join(outputDirectory, `${baseName}.zip`);
    await createZip(repoRoot, zipPath, manifestPaths);
  }

  if (options.format === "txt" || options.format === "both") {
    txtPath = path.join(outputDirectory, `${baseName}.txt`);
    await writeMergedTextFile(repoRoot, txtPath, manifestPaths, options.title, options.repoLabel);
  }

  console.log("Audit package created.");
  console.log(`Included files: ${manifestPaths.length}`);

  if (zipPath) {
    const zipStats = await stat(zipPath);
    console.log(`ZIP: ${displayPath(zipPath)} (${formatSize(zipStats.size)})`);
  }
  if (txtPath) {
    const txtStats = await stat(txtPath);
    console.log(`TXT: ${displayPath(txtPath)} (${formatSize(txtStats.size)})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
