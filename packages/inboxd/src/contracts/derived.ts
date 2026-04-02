import type {
  AttachmentParseJobClaimFilters,
  AttachmentParseJobFinalizeResult,
  AttachmentParseJobRecord,
  AttachmentParsePipeline,
  AttachmentParseState,
  CompleteAttachmentParseJobInput,
  FailAttachmentParseJobInput,
  RequeueAttachmentParseJobsInput,
} from '@murphai/parsers'

export type {
  AttachmentParseJobClaimFilters,
  AttachmentParseJobFinalizeResult,
  AttachmentParseJobRecord,
  AttachmentParsePipeline,
  AttachmentParseState,
  CompleteAttachmentParseJobInput,
  FailAttachmentParseJobInput,
  RequeueAttachmentParseJobsInput,
} from '@murphai/parsers'

export interface AttachmentParseJobFilters {
  captureId?: string
  attachmentId?: string
  state?: AttachmentParseState
  limit?: number
}
