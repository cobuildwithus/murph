export interface HostedAiUsageCreditActivityRow {
  addedLabel: string;
  dateLabel: string;
  id: string;
  sourceLabel: string;
}

export type HostedAiUsageMissionActivityStatus =
  | "checking_final_activity"
  | "completed"
  | "in_progress"
  | "reward_pending"
  | "waiting_for_group";

export interface HostedAiUsageMissionActivityRow {
  destinationLabel: string;
  id: string;
  requirementsLabel: string;
  rewardLabel: string;
  selectedLabel: string;
  status: HostedAiUsageMissionActivityStatus;
  statusLabel: string;
  timingLabel: string;
  title: string;
}

export interface HostedAiUsageActivitySnapshot {
  credits: readonly HostedAiUsageCreditActivityRow[];
  missions: readonly HostedAiUsageMissionActivityRow[];
  missionsEnabled: boolean;
  /** Browser-local invalidation only; absent only in inert design fixtures. */
  referralIdentityKey?: string;
}
