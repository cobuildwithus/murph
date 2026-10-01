import { OperatorTasksClient } from "../(dashboard)/ops/tasks/operator-tasks-client";

export function OpsOperatorTaskStudy() {
  return (
    <div className="rounded-2xl border border-border/70 bg-background p-6">
      <OperatorTasksClient
        initialTasks={[{
          completedAt: "2026-08-25T18:35:00.000Z",
          createdAt: "2026-08-25T18:30:00.000Z",
          expiresAt: "2026-08-25T18:40:00.000Z",
          id: "opt_design_diagnostic",
          kind: "diagnostic",
          memberId: "hbm_design_member",
          result: {
            answer:
              "The morning schedule selected the weekly recap definition while the sleep-summary occurrence was due. Check the automation identity attached to the occurrence before changing delivery behavior.",
            outcome: "answered",
          },
          source: "ops",
          status: "completed",
        }]}
      />
    </div>
  );
}
