export function readReviewGptRegistryInput(lockfile: string): {
  version: string;
  patchPath: string;
  patchHash: string;
  integrity: string;
};

export function addReviewGptDependencyContext(input: {
  head: string;
  changedFiles: string;
  contextDir: string;
  repoRoot?: string;
  fetchImpl?: (url: string, options: RequestInit) => Promise<Response>;
}): Promise<boolean>;
