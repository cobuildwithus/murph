const HOSTED_WORKSPACE_ROOT_KEYS = [
  "operator-home",
  "vault",
] as const;
const HOSTED_WORKSPACE_ROOT_KEY_SET = new Set<string>(HOSTED_WORKSPACE_ROOT_KEYS);

export function toHostedArtifactPathKey(input: {
  path: string;
  root?: string | null;
}): string {
  const normalizedPath = normalizeHostedArtifactPath(input.path);

  if (input.root) {
    return `${input.root}:${stripHostedWorkspaceRootPrefix(normalizedPath, input.root)}`;
  }

  const delimitedPath = parseDelimitedHostedArtifactPath(normalizedPath);
  if (delimitedPath) {
    return `${delimitedPath.root}:${stripHostedWorkspaceRootPrefix(
      delimitedPath.path,
      delimitedPath.root,
    )}`;
  }

  for (const root of HOSTED_WORKSPACE_ROOT_KEYS) {
    const prefixedPath = stripHostedWorkspaceRootPrefix(normalizedPath, root);
    if (prefixedPath !== normalizedPath) {
      return `${root}:${prefixedPath}`;
    }
  }

  return `vault:${normalizedPath}`;
}

function parseDelimitedHostedArtifactPath(value: string): {
  path: string;
  root: string;
} | null {
  const delimiterIndex = value.indexOf(":");
  if (delimiterIndex <= 0 || delimiterIndex >= value.length - 1) {
    return null;
  }

  const root = value.slice(0, delimiterIndex);
  if (!HOSTED_WORKSPACE_ROOT_KEY_SET.has(root)) {
    return null;
  }

  return {
    path: normalizeHostedArtifactPath(value.slice(delimiterIndex + 1)),
    root,
  };
}

function stripHostedWorkspaceRootPrefix(path: string, root: string): string {
  const normalizedPrefix = `${root}/`;
  return path.startsWith(normalizedPrefix)
    ? path.slice(normalizedPrefix.length)
    : path;
}

function normalizeHostedArtifactPath(value: string): string {
  return value
    .replace(/\\/gu, "/")
    .replace(/\/+/gu, "/")
    .replace(/^(?:\.\/)+/u, "")
    .replace(/^\/+|\/+$/gu, "");
}
