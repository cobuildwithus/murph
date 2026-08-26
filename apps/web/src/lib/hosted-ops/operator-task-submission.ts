export interface OperatorTaskSubmissionIdentity {
  fingerprint: string;
  key: string;
}

export function resolveOperatorTaskSubmissionIdentity(
  current: OperatorTaskSubmissionIdentity | null,
  fingerprint: string,
  createKey: () => string,
): OperatorTaskSubmissionIdentity {
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, key: createKey() };
}
