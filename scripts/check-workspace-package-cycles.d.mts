export type WorkspaceDependencyField =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies";

export type WorkspaceInternalDependency = {
  fields: WorkspaceDependencyField[];
  name: string;
};

export type WorkspacePackageEntry = {
  internalDependencies: WorkspaceInternalDependency[];
  name: string;
  packageJsonPath: string;
};

export type WorkspacePackageCycleEdge = {
  fields: WorkspaceDependencyField[];
  from: string;
  packageJsonPath: string;
  to: string;
};

export type WorkspacePackageCycle = {
  edges: WorkspacePackageCycleEdge[];
  packageNames: string[];
};

export function loadWorkspacePackages(rootDir?: string): Promise<WorkspacePackageEntry[]>;

export function collectInternalWorkspaceDependencies(
  packageJson: Record<string, unknown>,
  workspacePackageNames: Set<string>,
): WorkspaceInternalDependency[];

export function detectWorkspacePackageCycles(
  workspacePackages: WorkspacePackageEntry[],
): WorkspacePackageCycle[];

export function formatWorkspacePackageCycles(
  cycles: WorkspacePackageCycle[],
  rootDir?: string,
): string;

export function main(): Promise<void>;
