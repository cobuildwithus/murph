import 'server-only';
import { hostedProgressPicObjectKey } from '@murphai/hosted-execution/storage-paths';
import { readHostedExecutionControlClientIfConfigured } from '../../hosted-execution/control';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';

export function progressMediaStore() {
  const control = readHostedExecutionControlClientIfConfigured();
  if (!control) throw hostedOnboardingError({ code: 'PROGRESS_PIC_UNAVAILABLE', httpStatus: 503, retryable: true, message: 'Pictures could not load. Try again.' });
  return control;
}

/** Pictures and generated shares use the same permanent, exclusive-key tombstones. */
export async function purgeProgressMedia(memberId: string, storageKey: string): Promise<void> {
  try {
    await progressMediaStore().purgeRuntimeResource({ userId: memberId, resource: { kind: 'game_progress_pic',
      objectKey: hostedProgressPicObjectKey({ userId: memberId, mediaId: storageKey }) } });
  } catch {
    throw hostedOnboardingError({ code: 'PROGRESS_PIC_UNAVAILABLE', httpStatus: 503, retryable: true,
      message: 'Pictures could not be deleted. Try again.' });
  }
}

export const progressShareBytesTarget = (userId: string, key: string) => ({ userId,
  lane: 'hosted-member-private-field', scope: 'game-progress',
  aad: { purpose: 'game-progress', table: 'game_progress_share', rowId: key, field: 'bytes' } } as const);
