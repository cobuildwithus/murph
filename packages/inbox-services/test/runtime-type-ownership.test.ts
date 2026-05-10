import { expectTypeOf, test } from 'vitest'

import type {
  AttachmentParseJobRecord,
  InboxCaptureRecord,
  InboxPipeline,
  InboxRuntimeStore,
  InboxSearchHit,
  IndexedAttachment,
  InboundCapture,
  PersistedCapture,
  PollConnector,
} from '@murphai/inboxd'
import type {
  InboxPipeline as InboxServicesPipeline,
  PersistedCapture as InboxServicesPersistedCapture,
  PollConnector as InboxServicesPollConnector,
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeCaptureRecordInput,
  RuntimeSearchHit,
  RuntimeStore,
} from '@murphai/inbox-services'

type InboxServicesRuntimeStoreOwner = Pick<
  InboxRuntimeStore,
  | 'close'
  | 'getCursor'
  | 'setCursor'
  | 'claimNextAttachmentParseJob'
  | 'requeueAttachmentParseJobs'
  | 'completeAttachmentParseJob'
  | 'failAttachmentParseJob'
  | 'listCaptures'
  | 'searchCaptures'
  | 'listAttachmentParseJobs'
  | 'getCapture'
  | 'getAttachment'
>

test('inbox services runtime record types stay owned by inboxd', () => {
  expectTypeOf<RuntimeAttachmentRecord>().toEqualTypeOf<IndexedAttachment>()
  expectTypeOf<RuntimeCaptureRecord>().toEqualTypeOf<InboxCaptureRecord>()
  expectTypeOf<RuntimeSearchHit>().toEqualTypeOf<InboxSearchHit>()
  expectTypeOf<RuntimeAttachmentParseJobRecord>().toEqualTypeOf<AttachmentParseJobRecord>()
  expectTypeOf<RuntimeCaptureRecordInput>().toEqualTypeOf<InboundCapture>()
  expectTypeOf<InboxServicesPersistedCapture>().toEqualTypeOf<PersistedCapture>()
  expectTypeOf<InboxServicesPollConnector>().toEqualTypeOf<PollConnector>()
  expectTypeOf<InboxServicesPipeline>().toEqualTypeOf<InboxPipeline>()
  expectTypeOf<RuntimeStore>().toEqualTypeOf<InboxServicesRuntimeStoreOwner>()
})
