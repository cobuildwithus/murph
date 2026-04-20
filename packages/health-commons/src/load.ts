import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import {
  healthCommonsArtifactManifestSchema,
  healthCommonsChangeRecordSchema,
  healthCommonsPageFrontmatterSchema,
  healthCommonsRedirectsFileSchema,
  type HealthCommonsArtifactManifest,
  type HealthCommonsChangeRecord,
  type HealthCommonsPageFrontmatter,
  type HealthCommonsRedirect,
} from "@murphai/contracts";
import {
  parseFrontmatterDocument,
  parseFrontmatterScalar,
} from "@murphai/contracts";

export interface HealthCommonsSourcePage {
  body: string;
  frontmatter: HealthCommonsPageFrontmatter;
  rawFrontmatter: string | null;
  relativePath: string;
}

export interface HealthCommonsContentSet {
  artifactManifests: HealthCommonsArtifactManifest[];
  changes: HealthCommonsChangeRecord[];
  pages: HealthCommonsSourcePage[];
  redirects: HealthCommonsRedirect[];
}

export async function readHealthCommonsContent(contentRoot: string): Promise<HealthCommonsContentSet> {
  const [pages, redirects, changes, artifactManifests] = await Promise.all([
    readHealthCommonsPages(contentRoot),
    readHealthCommonsRedirects(contentRoot),
    readHealthCommonsChanges(contentRoot),
    readHealthCommonsArtifactManifests(contentRoot),
  ]);

  return {
    artifactManifests,
    changes,
    pages,
    redirects,
  };
}

export async function readHealthCommonsPages(contentRoot: string): Promise<HealthCommonsSourcePage[]> {
  const markdownPaths = await walkRelativeFiles(contentRoot, ".md");
  const pages: HealthCommonsSourcePage[] = [];

  for (const relativePath of markdownPaths) {
    const absolutePath = path.join(contentRoot, relativePath);
    const raw = await readFile(absolutePath, "utf8");
    const parsed = parseFrontmatterDocument(raw, {
      mode: "strict",
      bodyNormalization: "trim",
      allowSameIndentArrayItems: true,
      parseScalar: parseMarkdownScalar,
    });
    const frontmatter = healthCommonsPageFrontmatterSchema.parse(parsed.attributes);

    pages.push({
      body: parsed.body,
      frontmatter,
      rawFrontmatter: parsed.rawFrontmatter,
      relativePath: normalizePath(relativePath),
    });
  }

  pages.sort((left, right) => left.frontmatter.key.localeCompare(right.frontmatter.key));
  return pages;
}

export async function readHealthCommonsRedirects(contentRoot: string): Promise<HealthCommonsRedirect[]> {
  const relativePath = "redirects.json";
  const absolutePath = path.join(contentRoot, relativePath);

  try {
    const raw = await readFile(absolutePath, "utf8");
    return healthCommonsRedirectsFileSchema.parse(JSON.parse(raw) as unknown).redirects;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function readHealthCommonsChanges(contentRoot: string): Promise<HealthCommonsChangeRecord[]> {
  const changePaths = (await walkRelativeFiles(path.join(contentRoot, "changes"), ".jsonl"))
    .map((relativePath) => normalizePath(path.join("changes", relativePath)));
  const changes: HealthCommonsChangeRecord[] = [];

  for (const relativePath of changePaths) {
    const absolutePath = path.join(contentRoot, relativePath);
    const raw = await readFile(absolutePath, "utf8");
    const lines = raw.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) {
        continue;
      }
      try {
        changes.push(healthCommonsChangeRecordSchema.parse(JSON.parse(line) as unknown));
      } catch (error) {
        throw new Error(
          `Failed to parse health commons change at ${relativePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  changes.sort((left, right) => left.changeId.localeCompare(right.changeId));
  return changes;
}

export async function readHealthCommonsArtifactManifests(contentRoot: string): Promise<HealthCommonsArtifactManifest[]> {
  const artifactRoot = path.join(contentRoot, "artifacts");
  const manifestPaths = (await walkRelativeFiles(artifactRoot, ".json"))
    .map((relativePath) => normalizePath(path.join("artifacts", relativePath)));
  const manifests: HealthCommonsArtifactManifest[] = [];

  for (const relativePath of manifestPaths) {
    const absolutePath = path.join(contentRoot, relativePath);
    const raw = await readFile(absolutePath, "utf8");
    manifests.push(healthCommonsArtifactManifestSchema.parse(JSON.parse(raw) as unknown));
  }

  manifests.sort((left, right) => left.manifestKey.localeCompare(right.manifestKey));
  return manifests;
}

export async function walkRelativeFiles(root: string, extension: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(extension)) {
        files.push(normalizePath(path.relative(root, absolutePath)));
      }
    }
  }

  await walk(root);
  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function normalizePath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

function parseMarkdownScalar(value: string) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return parseFrontmatterScalar(trimmed);
}
