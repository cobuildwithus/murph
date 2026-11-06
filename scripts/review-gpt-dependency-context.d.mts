export function readReviewGptRegistryInput(lockfile: string, packageSlug?: 'review-gpt' | 'repo-tools'): {
  version: string;
  patchPath: string;
  patchHash: string;
  integrity: string;
};

export function addReviewGptDependencyContext(input: {
  head: string;
  baseHead?: string;
  changedFiles: string;
  contextDir: string;
  repoRoot?: string;
  fetchImpl?: (url: string, options: RequestInit) => Promise<Response>;
}): Promise<boolean>;
