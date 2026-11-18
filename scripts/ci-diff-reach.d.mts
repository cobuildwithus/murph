export const COUPLED_APPS: readonly string[];
export const BUNDLE_ONLY_DEPENDENCIES: Readonly<Record<string, readonly string[]>>;

export interface DiffReachWorkspace {
  readonly dirs: string[];
  readonly byName: Map<string, string>;
  readonly dependents: Map<string, string[]>;
  readonly readers: Array<{ dir: string; file: string; reads: string[] }>;
}

export interface DiffReach {
  readonly full: boolean;
  readonly changed: string[];
  readonly apps: boolean;
  readonly readerTests: Record<string, string[]>;
}

export function readWorkspace(root?: string): DiffReachWorkspace;
export function diffReach(changedFiles: string[], workspace: DiffReachWorkspace): DiffReach;
export function currentReach(env?: NodeJS.ProcessEnv, root?: string): DiffReach;
export function reachOutputs(reach: DiffReach): Record<string, string>;
