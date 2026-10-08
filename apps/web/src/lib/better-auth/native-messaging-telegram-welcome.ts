import "server-only";
import type { PrismaClient } from "@prisma/client";
import * as z from "@murphai/contracts/zod-runtime";
import { prepareHostedDomainRootForWeb, revalidatePreparedHostedDomainRootForWebTx } from "../hosted-crypto/domain-root-store";
import { runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { prepareHostedMailboxItemAppendCrypto } from "../hosted-mailbox/store";
import { renderUserFacingMessage } from "../hosted-messages/user-facing-messages";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { readHostedMemberRoutingState, upsertHostedMemberTelegramRoutingBindingTx } from "../hosted-onboarding/hosted-member-routing-store";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { enqueueHostedMemberChannelsUpdatedForActiveMemberTx } from "../hosted-onboarding/member-channel-sync";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { buildHostedTelegramBotLink } from "../hosted-onboarding/telegram";
import { callHostedTelegramApi } from "../hosted-onboarding/telegram-client";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";

const acceptedMessage = z.object({ ok: z.literal(true), result: z.object({
  message_id: z.number().int().positive(), chat: z.object({ id: z.number().int().positive(), type: z.literal("private") }),
}) });

// Called once, only after consuming a verified native login proof and committing
// its credential. Telegram documents no bot-access ID-token claim: requesting
// the scope is not delivery proof. The Bot API's accepted private message is.
export async function welcomeNativeMessagingTelegram(input: { memberId: string; telegramUserId: string; prisma: PrismaClient }) {
  const routing = await readHostedMemberRoutingState(input);
  if (routing?.telegramUserId !== input.telegramUserId) throw changedAccount();
  if (routing.telegramThreadId) return result(false);
  try {
    const response = acceptedMessage.safeParse(await callHostedTelegramApi({ method: "sendMessage", readJson: true, body: {
      chat_id: input.telegramUserId,
      text: renderUserFacingMessage({ context: {}, key: "assistant.signup_welcome", seed: `signup-welcome:${input.memberId}` }).text,
    } }));
    if (!response.success || String(response.data.result.chat.id) !== input.telegramUserId) return result(true);
  } catch {
    // Denied bot access, blocked bot, old clients and uncertain delivery all
    // preserve awaiting-inbound. Never synthesize a deliverable route.
    return result(true);
  }
  const root = await prepareHostedDomainRootForWeb({ domain: "control", prepareMissing: false, ...input, userId: input.memberId, reason: "hosted-auth.telegram-welcome" });
  const channelCrypto = await readActiveHostedMemberAccess(input)
    ? await prepareHostedMailboxItemAppendCrypto({ userId: input.memberId, prisma: input.prisma }) : null;
  const dispatch = await input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
    await lockHostedMemberRow(tx, input.memberId);
    await revalidatePreparedHostedDomainRootForWebTx({ prepared: root, tx });
    const current = await readHostedMemberRoutingState({ memberId: input.memberId, prisma: tx });
    // Do not restore an identity removed or replaced while Telegram was sending.
    if (current?.telegramUserId !== input.telegramUserId) throw changedAccount();
    await upsertHostedMemberTelegramRoutingBindingTx({ ...input, prisma: tx, telegramThreadId: input.telegramUserId });
    if (channelCrypto) await revalidatePreparedHostedDomainRootForWebTx({ prepared: channelCrypto, tx });
    return enqueueHostedMemberChannelsUpdatedForActiveMemberTx({ memberId: input.memberId, occurredAt: new Date().toISOString(), prisma: tx, sourceType: "settings.telegram.welcome" });
  }), { maxWait: 5_000, timeout: 10_000 });
  if (dispatch) await signalHostedMailboxAppendRuntime({ expectedUserId: input.memberId, mailboxItemId: dispatch.mailboxItemId }).catch(() => {
    // The committed mailbox owns wake recovery.
  });
  return result(false);
}

function result(telegramAwaitingInbound: boolean) {
  const link = buildHostedTelegramBotLink();
  const url = link ? new URL(link) : null;
  url?.searchParams.set("text", "Hey Murph");
  return { telegramAwaitingInbound, telegramUrl: url?.toString() ?? null };
}
function changedAccount() { return hostedOnboardingError({ code: "LINKED_ACCOUNT_CHANGED", httpStatus: 409, message: "Your sign-in methods changed. Try again." }); }
