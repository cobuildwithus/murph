#!/usr/bin/env node
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dependencySections = ["dependencies", "devDependencies", "optionalDependencies"];

export function syncExistingImporterLockfile({ importer, lockfileText, manifest }) {
  let nextLockfile = lockfileText;
  const added = [];

  for (const section of dependencySections) {
    for (const [dependency, specifier] of Object.entries(manifest[section] ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      const parsed = parseImporters(nextLockfile);
      const target = parsed.get(importer);
      if (!target) throw new Error(`Lockfile importer ${JSON.stringify(importer)} does not exist.`);
      if (target.sections.get(section)?.dependencies.has(dependency)) continue;

      const matchingBlocks = new Set();
      for (const candidate of parsed.values()) {
        for (const candidateSection of candidate.sections.values()) {
          const block = candidateSection.dependencies.get(dependency);
          if (block?.specifier === specifier) matchingBlocks.add(block.lines.join("\n"));
        }
      }
      if (matchingBlocks.size === 0) {
        throw new Error(`No existing lockfile entry matches ${dependency}@${specifier}; use pnpm for a real resolution.`);
      }
      if (matchingBlocks.size !== 1) {
        throw new Error(`Existing lockfile entries for ${dependency}@${specifier} are ambiguous; refusing to choose a peer snapshot.`);
      }

      nextLockfile = insertDependencyBlock(
        nextLockfile,
        target,
        section,
        [...matchingBlocks][0].split("\n"),
        dependency,
      );
      added.push(`${section}.${dependency}`);
    }
  }

  return { added, lockfileText: nextLockfile };
}

function parseImporters(text) {
  const lines = text.split("\n");
  const importersIndex = lines.indexOf("importers:");
  if (importersIndex < 0) throw new Error("pnpm-lock.yaml has no importers section.");
  let importersEnd = lines.length;
  for (let index = importersIndex + 1; index < lines.length; index += 1) {
    if (lines[index].length > 0 && !lines[index].startsWith(" ")) {
      importersEnd = index;
      break;
    }
  }

  const importerHeaders = [];
  for (let index = importersIndex + 1; index < importersEnd; index += 1) {
    const match = /^  (\S.*):$/u.exec(lines[index]);
    if (match) importerHeaders.push({ index, name: parseYamlScalar(match[1]) });
  }

  const importers = new Map();
  for (let importerIndex = 0; importerIndex < importerHeaders.length; importerIndex += 1) {
    const header = importerHeaders[importerIndex];
    const endIndex = importerHeaders[importerIndex + 1]?.index ?? importersEnd;
    const sections = new Map();
    const sectionHeaders = [];
    for (let index = header.index + 1; index < endIndex; index += 1) {
      const match = /^    (dependencies|devDependencies|optionalDependencies):$/u.exec(lines[index]);
      if (match) sectionHeaders.push({ index, name: match[1] });
    }
    for (let sectionIndex = 0; sectionIndex < sectionHeaders.length; sectionIndex += 1) {
      const sectionHeader = sectionHeaders[sectionIndex];
      let sectionEnd = sectionHeaders[sectionIndex + 1]?.index ?? endIndex;
      for (let index = sectionHeader.index + 1; index < sectionEnd; index += 1) {
        if (/^    \S/u.test(lines[index])) {
          sectionEnd = index;
          break;
        }
      }
      const dependencyHeaders = [];
      for (let index = sectionHeader.index + 1; index < sectionEnd; index += 1) {
        const match = /^      (\S.*):$/u.exec(lines[index]);
        if (match) dependencyHeaders.push({ index, name: parseYamlScalar(match[1]) });
      }
      const dependencies = new Map();
      for (let dependencyIndex = 0; dependencyIndex < dependencyHeaders.length; dependencyIndex += 1) {
        const dependencyHeader = dependencyHeaders[dependencyIndex];
        const blockEnd = dependencyHeaders[dependencyIndex + 1]?.index ?? sectionEnd;
        const blockLines = lines.slice(dependencyHeader.index, blockEnd);
        while (blockLines.at(-1) === "") blockLines.pop();
        dependencies.set(dependencyHeader.name, {
          lines: blockLines,
          specifier: readScalar(blockLines, "specifier"),
          startIndex: dependencyHeader.index,
        });
      }
      sections.set(sectionHeader.name, {
        dependencies,
        endIndex: sectionEnd,
        headerIndex: sectionHeader.index,
      });
    }
    importers.set(header.name, { endIndex, headerIndex: header.index, sections });
  }
  return importers;
}

function readScalar(lines, property) {
  const prefix = `        ${property}:`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line ? parseYamlScalar(line.slice(prefix.length).trim()) : undefined;
}

function parseYamlScalar(value) {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  return value;
}

function insertDependencyBlock(text, importer, sectionName, blockLines, dependency) {
  const lines = text.split("\n");
  const section = importer.sections.get(sectionName);
  let insertionIndex;
  const insertedLines = [...blockLines];

  if (section) {
    insertionIndex = section.endIndex;
    for (const [existingDependency, block] of section.dependencies) {
      if (dependency.localeCompare(existingDependency) < 0) {
        insertionIndex = block.startIndex;
        break;
      }
    }
  } else {
    insertionIndex = importer.endIndex;
    while (insertionIndex > importer.headerIndex + 1 && lines[insertionIndex - 1] === "") insertionIndex -= 1;
    insertedLines.unshift(`    ${sectionName}:`);
  }

  lines.splice(insertionIndex, 0, ...insertedLines);
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const check = args[0] === "--check";
  const importer = args[check ? 1 : 0];
  if (!importer || args.length !== (check ? 2 : 1)) {
    throw new Error("Usage: pnpm lockfile:sync-existing -- [--check] <workspace-importer>");
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifestPath = path.join(repoRoot, importer, "package.json");
  const lockfilePath = path.join(repoRoot, "pnpm-lock.yaml");
  const [manifestText, lockfileText, lockfileStat] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(lockfilePath, "utf8"),
    stat(lockfilePath),
  ]);
  const result = syncExistingImporterLockfile({
    importer,
    lockfileText,
    manifest: JSON.parse(manifestText),
  });
  if (result.added.length === 0) {
    console.log(`Lockfile importer ${importer} already matches its manifest.`);
    return;
  }
  if (check) throw new Error(`Lockfile importer ${importer} is missing: ${result.added.join(", ")}.`);

  const temporaryPath = `${lockfilePath}.sync-${process.pid}`;
  await writeFile(temporaryPath, result.lockfileText, { mode: lockfileStat.mode });
  await rename(temporaryPath, lockfilePath);
  console.log(`Added existing locked entries to ${importer}: ${result.added.join(", ")}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
