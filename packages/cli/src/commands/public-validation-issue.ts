export function publicValidationIssue(
  issue: { readonly code: string },
  publicPath: readonly (string | number)[],
) {
  return {
    code: issue.code,
    publicPath,
  }
}
