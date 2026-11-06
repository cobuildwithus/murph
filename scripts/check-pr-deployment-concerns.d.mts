export const APPLICABLE_FIELDS: readonly string[];

export function validatePrDeploymentConcerns(input: {
  readonly prBodyHtml: string;
}): string[];
