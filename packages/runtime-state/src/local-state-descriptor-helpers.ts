import path from "node:path";

export type VaultLocalStateClassification = "operational" | "projection" | "ephemeral";
export type VaultLocalStatePortability = "portable" | "machine_local";
export type VaultLocalStateDescriptorMatchKind = "file" | "directory" | "subtree" | "prefix";

export interface VaultLocalStatePathDescriptor {
  classification: VaultLocalStateClassification;
  description: string;
  matchKind: VaultLocalStateDescriptorMatchKind;
  owner: string;
  portability: VaultLocalStatePortability;
  rebuildable: boolean;
  relativePath: string;
}

interface DefineLocalStateDescriptorInput {
  classification: VaultLocalStateClassification;
  description: string;
  matchKind: VaultLocalStateDescriptorMatchKind;
  owner: string;
  portability: VaultLocalStatePortability;
  rebuildable: boolean;
  relativePath: string;
}

export function normalizeVaultLocalStateRelativePath(value: string): string {
  return value
    .replace(/\\/gu, "/")
    .replace(/\/+/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/^\/+|\/+$/gu, "");
}

export function defineLocalStateFileDescriptor(
  input: Omit<DefineLocalStateDescriptorInput, "matchKind">,
): VaultLocalStatePathDescriptor {
  return defineLocalStateDescriptor({
    ...input,
    matchKind: "file",
  });
}

export function defineLocalStateDirectoryDescriptor(
  input: Omit<DefineLocalStateDescriptorInput, "matchKind">,
): VaultLocalStatePathDescriptor {
  return defineLocalStateDescriptor({
    ...input,
    matchKind: "directory",
  });
}

export function defineLocalStateSubtreeDescriptor(
  input: Omit<DefineLocalStateDescriptorInput, "matchKind">,
): VaultLocalStatePathDescriptor {
  return defineLocalStateDescriptor({
    ...input,
    matchKind: "subtree",
  });
}

export function defineLocalStatePrefixDescriptor(
  input: Omit<DefineLocalStateDescriptorInput, "matchKind">,
): VaultLocalStatePathDescriptor {
  return defineLocalStateDescriptor({
    ...input,
    matchKind: "prefix",
  });
}

export function descriptorMatchesRelativePath(
  relativePath: string,
  descriptor: VaultLocalStatePathDescriptor,
): boolean {
  const normalized = normalizeVaultLocalStateRelativePath(relativePath);

  switch (descriptor.matchKind) {
    case "file":
    case "directory":
      return normalized === descriptor.relativePath;
    case "subtree":
      return hasPathPrefix(normalized, descriptor.relativePath);
    case "prefix":
      return normalized === descriptor.relativePath || normalized.startsWith(descriptor.relativePath);
  }
}

export function findMostSpecificMatchingLocalStateDescriptor(
  relativePath: string,
  descriptors: readonly VaultLocalStatePathDescriptor[],
  classification?: VaultLocalStateClassification,
): VaultLocalStatePathDescriptor | null {
  const normalized = normalizeVaultLocalStateRelativePath(relativePath);
  let bestMatch: VaultLocalStatePathDescriptor | null = null;

  for (const descriptor of descriptors) {
    if (classification && descriptor.classification !== classification) {
      continue;
    }

    if (!descriptorMatchesRelativePath(normalized, descriptor)) {
      continue;
    }

    if (!bestMatch || compareDescriptorSpecificity(descriptor, bestMatch) > 0) {
      bestMatch = descriptor;
    }
  }

  return bestMatch;
}

export function isPortableLocalStateContainerRelativePath(
  relativePath: string,
  descriptors: readonly VaultLocalStatePathDescriptor[],
  classification?: VaultLocalStateClassification,
): boolean {
  const normalized = normalizeVaultLocalStateRelativePath(relativePath);

  for (const descriptor of descriptors) {
    if (descriptor.portability !== "portable") {
      continue;
    }

    if (classification && descriptor.classification !== classification) {
      continue;
    }

    if (descriptorProvidesPortableContainer(normalized, descriptor)) {
      return true;
    }
  }

  return false;
}

function defineLocalStateDescriptor(
  input: DefineLocalStateDescriptorInput,
): VaultLocalStatePathDescriptor {
  return {
    ...input,
    relativePath: normalizeVaultLocalStateRelativePath(input.relativePath),
  };
}

function compareDescriptorSpecificity(
  left: VaultLocalStatePathDescriptor,
  right: VaultLocalStatePathDescriptor,
): number {
  const pathLengthDelta = left.relativePath.length - right.relativePath.length;
  if (pathLengthDelta !== 0) {
    return pathLengthDelta;
  }

  return descriptorMatchPriority(left.matchKind) - descriptorMatchPriority(right.matchKind);
}

function descriptorMatchPriority(matchKind: VaultLocalStateDescriptorMatchKind): number {
  switch (matchKind) {
    case "file":
      return 4;
    case "directory":
      return 3;
    case "subtree":
      return 2;
    case "prefix":
      return 1;
  }
}

function descriptorProvidesPortableContainer(
  relativePath: string,
  descriptor: VaultLocalStatePathDescriptor,
): boolean {
  switch (descriptor.matchKind) {
    case "file":
      return isStrictAncestorPath(relativePath, descriptor.relativePath);
    case "directory":
    case "subtree":
      return hasPathPrefix(descriptor.relativePath, relativePath);
    case "prefix": {
      const containerRoot = normalizeVaultLocalStateRelativePath(
        path.posix.dirname(descriptor.relativePath),
      );
      return containerRoot.length > 0 && hasPathPrefix(containerRoot, relativePath);
    }
  }
}

function hasPathPrefix(relativePath: string, prefix: string): boolean {
  return relativePath === prefix || relativePath.startsWith(`${prefix}${path.posix.sep}`);
}

function isStrictAncestorPath(ancestorPath: string, targetPath: string): boolean {
  return ancestorPath !== targetPath && targetPath.startsWith(`${ancestorPath}${path.posix.sep}`);
}
