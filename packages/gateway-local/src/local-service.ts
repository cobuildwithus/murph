import {
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
} from '@murph/gateway-core'
import {
  fetchGatewayAttachmentsFromSnapshot,
  getGatewayConversationFromSnapshot,
  listGatewayConversationsFromSnapshot,
  readGatewayMessagesFromSnapshot,
} from '@murph/gateway-core'
import {
  exportGatewayProjectionSnapshotLocal,
  listGatewayOpenPermissionsLocal,
  pollGatewayEventsLocal,
  respondToGatewayPermissionLocal,
  waitForGatewayEventsLocal,
} from './store.js'
import { sendGatewayMessageLocal } from './send.js'

export function createLocalGatewayService(vault: string): GatewayService {
  return {
    fetchAttachments: (input) => fetchGatewayAttachmentsLocal(vault, input),
    getConversation: (input) => getGatewayConversationLocal(vault, input),
    listConversations: (input) => listGatewayConversationsLocal(vault, input),
    listOpenPermissions: (input) => listGatewayOpenPermissionsLocalWrapper(vault, input),
    pollEvents: (input) => pollGatewayEventsLocalWrapper(vault, input),
    readMessages: (input) => readGatewayMessagesLocal(vault, input),
    respondToPermission: (input) => respondToGatewayPermissionLocalWrapper(vault, input),
    sendMessage: (input) => sendGatewayMessage(vault, input),
    waitForEvents: (input) => waitGatewayEventsLocal(vault, input),
  }
}

export async function listGatewayConversationsLocal(
  vault: string,
  input?: GatewayListConversationsInput,
): Promise<GatewayListConversationsResult> {
  const parsed = gatewayListConversationsInputSchema.parse(input ?? {})
  const snapshot = await exportGatewayProjectionSnapshotLocal(vault)
  return listGatewayConversationsFromSnapshot(snapshot, parsed)
}

export async function getGatewayConversationLocal(
  vault: string,
  input: GatewayGetConversationInput,
) {
  const parsed = gatewayGetConversationInputSchema.parse(input)
  const snapshot = await exportGatewayProjectionSnapshotLocal(vault)
  return getGatewayConversationFromSnapshot(snapshot, parsed)
}

export async function readGatewayMessagesLocal(
  vault: string,
  input: GatewayReadMessagesInput,
): Promise<GatewayReadMessagesResult> {
  const parsed = gatewayReadMessagesInputSchema.parse(input)
  const snapshot = await exportGatewayProjectionSnapshotLocal(vault)
  return readGatewayMessagesFromSnapshot(snapshot, parsed)
}

export async function fetchGatewayAttachmentsLocal(
  vault: string,
  input: GatewayFetchAttachmentsInput,
) {
  const parsed = gatewayFetchAttachmentsInputSchema.parse(input)
  const snapshot = await exportGatewayProjectionSnapshotLocal(vault)
  return fetchGatewayAttachmentsFromSnapshot(snapshot, parsed)
}

export async function pollGatewayEventsLocalWrapper(
  vault: string,
  input?: GatewayPollEventsInput,
): Promise<GatewayPollEventsResult> {
  const parsed = gatewayPollEventsInputSchema.parse(input ?? {})
  return pollGatewayEventsLocal(vault, parsed)
}

export async function sendGatewayMessage(
  vault: string,
  input: Parameters<GatewayService['sendMessage']>[0],
) {
  const parsed = gatewaySendMessageInputSchema.parse(input)
  return sendGatewayMessageLocal({
    ...parsed,
    vault,
  })
}

export async function waitGatewayEventsLocal(
  vault: string,
  input?: GatewayWaitForEventsInput,
): Promise<GatewayPollEventsResult> {
  const parsed = gatewayWaitForEventsInputSchema.parse(input ?? {})
  return waitForGatewayEventsLocal(vault, parsed)
}

export async function listGatewayOpenPermissionsLocalWrapper(
  vault: string,
  input?: Parameters<GatewayService['listOpenPermissions']>[0],
) {
  const parsed = gatewayListOpenPermissionsInputSchema.parse(input ?? {})
  return listGatewayOpenPermissionsLocal(vault, parsed)
}

export async function respondToGatewayPermissionLocalWrapper(
  vault: string,
  input: Parameters<GatewayService['respondToPermission']>[0],
) {
  return respondToGatewayPermissionLocal(vault, input)
}
