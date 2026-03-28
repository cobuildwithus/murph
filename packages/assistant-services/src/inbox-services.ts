import {
  createIntegratedInboxCliServices as createMurphIntegratedInboxCliServices,
  type InboxCliServices,
} from "murph/inbox-services";

export type { InboxCliServices };

export function createIntegratedInboxCliServices(
  ...args: Parameters<typeof createMurphIntegratedInboxCliServices>
): ReturnType<typeof createMurphIntegratedInboxCliServices> {
  return createMurphIntegratedInboxCliServices(...args);
}
