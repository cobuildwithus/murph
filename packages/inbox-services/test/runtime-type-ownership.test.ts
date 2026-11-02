import { expectTypeOf, test } from 'vitest'

import type {
  PersistedCapture as InboxServicesPersistedCapture,
  InboxPipeline as InboxServicesPipeline,
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeCaptureRecordInput,
  RuntimeSearchHit,
  RuntimeStore,
} from '@murphai/inbox-services'
import type {
  AttachmentParseJobRecord,
  InboundCapture,
  InboxCaptureRecord,
  InboxPipeline,
  InboxRuntimeStore,
  InboxSearchHit,
  IndexedAttachment,
  PersistedCapture,
} from '@murphai/inboxd'

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
  expectTypeOf<InboxServicesPipeline>().toEqualTypeOf<InboxPipeline>()
  expectTypeOf<RuntimeStore>().toEqualTypeOf<InboxServicesRuntimeStoreOwner>()
})
