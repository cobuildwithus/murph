export interface NativeIosHostedE2eIssue {
  code: string;
  message: string;
}

export interface NativeIosHostedE2eSources {
  control: string;
  docs: string;
  e2eMigration: string;
  publicUrl: string;
  repoHygiene: string;
  vercel: string;
  webPackage: string;
  workflow: string;
}

export function inspectNativeIosHostedE2eBoundary(
  sources: NativeIosHostedE2eSources,
): NativeIosHostedE2eIssue[];

export function readNativeIosHostedE2eSources(): Promise<NativeIosHostedE2eSources>;
