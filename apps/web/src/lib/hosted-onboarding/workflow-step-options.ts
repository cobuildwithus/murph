type HostedWorkflowStepFunction = (...args: never[]) => unknown;

export type HostedWorkflowStep<TStep extends HostedWorkflowStepFunction> = TStep & {
  maxRetries?: number;
};

export function withHostedWorkflowStepMaxRetries<
  TStep extends HostedWorkflowStepFunction,
>(
  step: TStep,
  maxRetries: number,
): HostedWorkflowStep<TStep> {
  return Object.assign(step, {
    maxRetries,
  });
}
