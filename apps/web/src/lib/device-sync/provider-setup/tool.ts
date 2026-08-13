import "server-only";

import { deviceSyncError } from "@murphai/device-syncd/errors";
import type {
  HostedRuntimeProviderSetupToolRequest,
} from "@murphai/hosted-execution/provider-setup";

import {
  isMemberOwnedDeviceProviderApplicationProvider,
} from "../provider-applications";
import { createMemberOwnedProviderSetupService } from "./service";

export async function handleHostedRuntimeProviderSetupTool(input: {
  memberId: string;
  request: HostedRuntimeProviderSetupToolRequest;
}): Promise<unknown> {
  const provider = input.request.provider;
  if (!isMemberOwnedDeviceProviderApplicationProvider(provider)) {
    throw deviceSyncError({
      code: "DEVICE_PROVIDER_SETUP_PROVIDER_UNSUPPORTED",
      httpStatus: 400,
      message: "Private provider setup is not supported for this source.",
      retryable: false,
    });
  }

  const service = createMemberOwnedProviderSetupService(provider);
  switch (input.request.action) {
    case "begin":
      return service.beginBrowserSetup(input.memberId);
    case "capture":
      return service.captureAndSeal(input.memberId, input.request);
    case "prepare_delete":
      return service.prepareDeletion(input.memberId);
    case "delete":
      return service.deleteOwnedApplication(input.memberId, input.request);
    case "confirm_missing":
      return service.confirmOwnedApplicationMissing(input.memberId, input.request);
  }
}
