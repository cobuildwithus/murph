import type {
  HostedComputerAwaitingReason,
  HostedComputerFinishOutcome,
} from "@murphai/hosted-execution/computer-use";

import type {
  MemberOwnedDeviceProviderApplicationProvider,
  DeviceProviderApplicationView,
} from "../provider-applications";
import {
  MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
  type MemberOwnedProviderSetupComputerRunPurpose,
} from "../../computer-use/store";
import type {
  MemberOwnedProviderApplicationCreateResult,
  MemberOwnedProviderApplicationDeleteResult,
  MemberOwnedProviderDashboardInspection,
} from "./types";

export interface MemberOwnedProviderSetupBrowserRun {
  awaitingReason: HostedComputerAwaitingReason | null;
  reused: boolean;
  runId: string;
  status: string;
}

export interface MemberOwnedProviderSetupHandoff {
  handoffUrl: string | null;
  runId: string;
}

export interface MemberOwnedProviderSetupComputer {
  acquireOwnedRun(input: {
    expectedRunId: string | null;
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
  }): Promise<MemberOwnedProviderSetupBrowserRun>;
  actOwnedRun(input: {
    code: string;
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    runId: string;
    timeoutMs: number;
  }): Promise<{ result: unknown; title: string | null; url: string | null }>;
  captureAndSealProviderCredentialsInOwnedRun<T>(input: {
    code: string;
    consume: (credentials: { clientId: string; clientSecret: string }) => Promise<T>;
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    runId: string;
    timeoutMs: number;
  }): Promise<{ title: string | null; url: string | null; value: T }>;
  pauseOwnedRunForUser(input: {
    handoffPurpose: "captcha" | "managed_login" | "manual_browser_help";
    memberId: string;
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    reason: "login_needed" | "other";
    runId: string;
    suggestedReply: string | null;
  }): Promise<{
    handoffUrl: string | null;
    runId: string;
  }>;
  finishOwnedRun(input: {
    memberId: string;
    outcome: "canceled";
    ownerKey: string;
    ownerPurpose: MemberOwnedProviderSetupComputerRunPurpose;
    runId: string;
  }): Promise<{
    ok: true;
    runId: string;
    status: HostedComputerFinishOutcome;
  }>;
}

export interface MemberOwnedProviderSetupCoordinates<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> {
  connectSourceId: string;
  connectTarget: string;
  provider: TProvider;
  sourceProviderSlug: string | null;
}

export interface MemberOwnedProviderSetupAdapter<
  TProvider extends string = MemberOwnedDeviceProviderApplicationProvider,
> extends MemberOwnedProviderSetupCoordinates<TProvider> {
  createOwnedApplication(input: {
    memberId: string;
    runId: string;
    setupId: string;
  }): Promise<MemberOwnedProviderApplicationCreateResult>;
  captureAndSealOwnedApplication(input: {
    expectedRevision: number | null;
    memberId: string;
    runId: string;
    setupId: string;
  }): Promise<DeviceProviderApplicationView<TProvider>>;
  cancelBrowserRun(input: {
    memberId: string;
    runId: string;
    setupId: string;
  }): Promise<HostedComputerFinishOutcome>;
  deleteOwnedApplication(input: {
    memberId: string;
    runId: string;
    setupId: string;
  }): Promise<MemberOwnedProviderApplicationDeleteResult>;
  finishBrowserRun(input: {
    memberId: string;
    runId: string;
    setupId: string;
  }): Promise<HostedComputerFinishOutcome>;
  ensureBrowserRun(input: {
    expectedRunId: string | null;
    memberId: string;
    setupId: string;
  }): Promise<MemberOwnedProviderSetupBrowserRun>;
  inspectDashboard(input: {
    memberId: string;
    runId: string;
    setupId: string;
  }): Promise<MemberOwnedProviderDashboardInspection>;
  pauseForUser(input: {
    memberId: string;
    reason: "challenge" | "prerequisite" | "signed_out";
    runId: string;
    setupId: string;
  }): Promise<MemberOwnedProviderSetupHandoff>;
}

export { MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE };
