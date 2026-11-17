import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS, lockHostedMemberRow } from '../../hosted-onboarding/shared';
import { PROGRESS_SHARE_CONSENT_SCOPE, recordHostedConsentDecisionTx } from '../../legal/consent';
import type { BeforeProgressMutation } from './state';
import { purgeProgressShares, retireProgressSharesTx } from './share-cleanup';
import type { ShareConsentResponse } from './contract';

/** No recorded choice allows pictures; an explicit denial turns them off. */
export async function readProgressShareConsent(input: {
  memberId: string;
  prisma: Pick<PrismaClient, 'hostedConsentGrant' | 'hostedConsentEvent'>;
}): Promise<ShareConsentResponse> {
  const { memberId, prisma } = input;
  const grant = await prisma.hostedConsentGrant.findUnique({ where: { memberId_scope: { memberId, scope: PROGRESS_SHARE_CONSENT_SCOPE } }, select: { status: true } });
  const event = grant ? null : await prisma.hostedConsentEvent.findFirst({ where: { memberId, scope: PROGRESS_SHARE_CONSENT_SCOPE }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { action: true } });
  return { decision: grant ? grant.status === 'granted' ? 'allowed' : 'denied' : event ? 'denied' : 'allowed' };
}

/** Both native decisions and Web Privacy withdrawal use this one atomic owner. */
export async function decideProgressShareConsent(input: {
  memberId: string;
  decision: 'allow' | 'deny';
  prisma: PrismaClient;
  beforeMutationTx: BeforeProgressMutation;
}): Promise<ShareConsentResponse> {
  const { memberId, decision, prisma } = input;
  const keys = await prisma.$transaction(async tx => {
    await lockHostedMemberRow(tx, memberId);
    await input.beforeMutationTx(tx);
    await recordHostedConsentDecisionTx({ tx, memberId, decision, scope: PROGRESS_SHARE_CONSENT_SCOPE,
      source: 'ios-progress-share', now: new Date(), metadata: { disclosureVersion: 1 } });
    return decision === 'deny' ? retireProgressSharesTx(tx, { memberId }) : [];
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  // Repeated denial skips its audit write but still purges every retained key.
  await purgeProgressShares(memberId, keys);
  return { decision: decision === 'allow' ? 'allowed' : 'denied' };
}
