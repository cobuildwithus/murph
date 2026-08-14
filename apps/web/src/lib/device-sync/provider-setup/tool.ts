import "server-only";

import { deviceSyncError } from "@murphai/device-syncd/errors";
import type {
  HostedRuntimeProviderSetupContinuationValidateRequest,
  HostedRuntimeProviderSetupToolRequest,
} from "@murphai/hosted-execution/provider-setup";

import {
  isMemberOwnedDeviceProviderApplicationProvider,
} from "../provider-applications";
import { createMemberOwnedProviderSetupService } from "./service";

export async function handleHostedRuntimeProviderSetupContinuationValidation(input: {
  memberId: string;
  request: HostedRuntimeProviderSetupContinuationValidateRequest;
}): Promise<{ accepted: boolean }> {
  const service = requireProviderSetupService(input.request.provider);
  return {
    accepted: await service.validateContinuation({
      expectedSetupId: input.request.setupId,
      expectedSetupVersion: input.request.setupVersion,
      memberId: input.memberId,
    }),
  };
}

export async function handleHostedRuntimeProviderSetupTool(input: {
  memberId: string;
  request: HostedRuntimeProviderSetupToolRequest;
}): Promise<unknown> {
  const service = requireProviderSetupService(input.request.provider);
  switch (input.request.action) {
    case "begin":
      return service.beginBrowserSetup(input.memberId);
    case "capture":
      return service.captureAndSeal(input.memberId, input.request);
    case "prepare_delete":
      return service.prepareDeletion(input.memberId);
    case "delete":
      return service.deleteOwnedApplication(input.memberId, input.request);
  }
}

function requireProviderSetupService(provider: string) {
  if (!isMemberOwnedDeviceProviderApplicationProvider(provider)) {
    throw deviceSyncError({
      code: "DEVICE_PROVIDER_SETUP_PROVIDER_UNSUPPORTED",
      httpStatus: 400,
      message: "Private provider setup is not supported for this source.",
      retryable: false,
    });
  }
  return createMemberOwnedProviderSetupService(provider);
}
