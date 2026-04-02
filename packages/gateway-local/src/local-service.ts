import {
  type GatewayLocalDispatchMode,
  type GatewayLocalMessageSender,
  gatewayFetchAttachmentsInputSchema,
  gatewayGetConversationInputSchema,
  gatewayListConversationsInputSchema,
  gatewayListOpenPermissionsInputSchema,
  gatewayPollEventsInputSchema,
  gatewayReadMessagesInputSchema,
  gatewaySendMessageInputSchema,
  gatewayWaitForEventsInputSchema,
  type GatewayFetchAttachmentsInput,
  type GatewayGetConversationInput,
  type GatewayListConversationsInput,
  type GatewayListConversationsResult,
  type GatewayPollEventsInput,
  type GatewayPollEventsResult,
  type GatewayReadMessagesInput,
  type GatewayReadMessagesResult,
  type GatewayService,
  type GatewayWaitForEventsInput,
} from '@murphai/gateway-core'
import {
  fetchGatewayAttachmentsFromSnapshot,
  getGatewayConversationFromSnapshot,
  listGatewayConversationsFromSnapshot,
  readGatewayMessagesFromSnapshot,
} from '@murphai/gateway-core'
import {
  exportGatewayProjectionSnapshotLocal,
  type LocalGatewayProjectionStoreDependencies,
  listGatewayOpenPermissionsLocal,
  pollGatewayEventsLocal,
  respondToGatewayPermissionLocal,
  waitForGatewayEventsLocal,
} from './store.js'
import { sendGatewayMessageLocal } from './send.js'

export interface LocalGatewayServiceDependencies extends LocalGatewayProjectionStoreDependencies {
  dispatchMode?: GatewayLocalDispatchMode
  messageSender?: GatewayLocalMessageSender
}

export function createLocalGatewayService(
  vault: string,
  dependencies: LocalGatewayServiceDependencies = {},
): GatewayService {
  return {
    fetchAttachments: (input) => fetchGatewayAttachmentsLocal(vault, input, dependencies),
    getConversation: (input) => getGatewayConversationLocal(vault, input, dependencies),
    listConversations: (input) => listGatewayConversationsLocal(vault, input, dependencies),
    listOpenPermissions: (input) =>
      listGatewayOpenPermissionsLocalWrapper(vault, input, dependencies),
    pollEvents: (input) => pollGatewayEventsLocalWrapper(vault, input, dependencies),
    readMessages: (input) => readGatewayMessagesLocal(vault, input, dependencies),
    respondToPermission: (input) =>
      respondToGatewayPermissionLocalWrapper(vault, input, dependencies),
    sendMessage: (input) => sendGatewayMessage(vault, input, dependencies),
    waitForEvents: (input) => waitGatewayEventsLocal(vault, input, dependencies),
  }
}

export async function listGatewayConversationsLocal(
  vault: string,
  input?: GatewayListConversationsInput,
  dependencies: LocalGatewayProjectionStoreDependencies = {},
): Promise<GatewayListConversationsResult> {
  const parsed = gatewayListConversationsInputSchema.parse(input ?? {})
  const snapshot = await exportGatewayProjectionSnapshotLocal(vault, dependencies)
  return listGatewayConversationsFromSnapshot(snapshot, parsed)
}

export async function getGatewayConversationLocal(
  vault: string,
  input: GatewayGetConversationInput,
  dependencies: LocalGatewayProjectionStoreDependencies = {},
) {
  const parsed = gatewayGetConversationInputSchema.parse(input)
  const snapshot = await exportGatewayProjectionSnapshotLocal(vault, dependencies)
  return getGatewayConversationFromSnapshot(snapshot, parsed)
}

export async function readGatewayMessagesLocal(
  vault: string,
  input: GatewayReadMessagesInput,
  dependencies: LocalGatewayProjectionStoreDependencies = {},
): Promise<GatewayReadMessagesResult> {
  const parsed = gatewayReadMessagesInputSchema.parse(input)
  const snapshot = await exportGatewayProjectionSnapshotLocal(vault, dependencies)
  return readGatewayMessagesFromSnapshot(snapshot, parsed)
}

export async function fetchGatewayAttachmentsLocal(
  vault: string,
  input: GatewayFetchAttachmentsInput,
  dependencies: LocalGatewayProjectionStoreDependencies = {},
) {
  const parsed = gatewayFetchAttachmentsInputSchema.parse(input)
  const snapshot = await exportGatewayProjectionSnapshotLocal(vault, dependencies)
  return fetchGatewayAttachmentsFromSnapshot(snapshot, parsed)
}

export async function pollGatewayEventsLocalWrapper(
  vault: string,
  input?: GatewayPollEventsInput,
  dependencies: LocalGatewayProjectionStoreDependencies = {},
): Promise<GatewayPollEventsResult> {
  const parsed = gatewayPollEventsInputSchema.parse(input ?? {})
  return pollGatewayEventsLocal(vault, parsed, dependencies)
}

export async function sendGatewayMessage(
  vault: string,
  input: Parameters<GatewayService['sendMessage']>[0],
  dependencies: LocalGatewayServiceDependencies = {},
) {
  const parsed = gatewaySendMessageInputSchema.parse(input)
  return sendGatewayMessageLocal({
    dispatchMode: dependencies.dispatchMode,
    messageSender: dependencies.messageSender,
    sourceReader: dependencies.sourceReader,
    ...parsed,
    vault,
  })
}

export async function waitGatewayEventsLocal(
  vault: string,
  input?: GatewayWaitForEventsInput,
  dependencies: LocalGatewayProjectionStoreDependencies = {},
): Promise<GatewayPollEventsResult> {
  const parsed = gatewayWaitForEventsInputSchema.parse(input ?? {})
  return waitForGatewayEventsLocal(vault, parsed, dependencies)
}

export async function listGatewayOpenPermissionsLocalWrapper(
  vault: string,
  input?: Parameters<GatewayService['listOpenPermissions']>[0],
  dependencies: LocalGatewayProjectionStoreDependencies = {},
) {
  const parsed = gatewayListOpenPermissionsInputSchema.parse(input ?? {})
  return listGatewayOpenPermissionsLocal(vault, parsed, dependencies)
}

export async function respondToGatewayPermissionLocalWrapper(
  vault: string,
  input: Parameters<GatewayService['respondToPermission']>[0],
  dependencies: LocalGatewayProjectionStoreDependencies = {},
) {
  return respondToGatewayPermissionLocal(vault, input, dependencies)
}
