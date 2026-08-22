export function syncExistingImporterLockfile(input: {
  importer: string;
  lockfileText: string;
  manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
}): {
  added: string[];
  lockfileText: string;
};
