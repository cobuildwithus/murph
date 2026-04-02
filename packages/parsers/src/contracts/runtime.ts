export type AttachmentParsePipeline = "attachment_text";
export type AttachmentParseState = "pending" | "running" | "succeeded" | "failed";

export interface AttachmentParseJobRecord {
  jobId: string;
  captureId: string;
  attachmentId: string;
  pipeline: AttachmentParsePipeline;
  state: AttachmentParseState;
  attempts: number;
  providerId?: string | null;
  resultPath?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface AttachmentParseJobClaimFilters {
  captureId?: string;
  attachmentId?: string;
}

export interface RequeueAttachmentParseJobsInput {
  captureId?: string;
  attachmentId?: string;
  state?: AttachmentParseState;
}

export interface CompleteAttachmentParseJobInput {
  jobId: string;
  attempt: number;
  providerId: string;
  resultPath: string;
  extractedText?: string | null;
  transcriptText?: string | null;
  finishedAt?: string;
}

export interface FailAttachmentParseJobInput {
  jobId: string;
  attempt: number;
  providerId?: string | null;
  errorCode?: string | null;
  errorMessage: string;
  finishedAt?: string;
}

export interface AttachmentParseJobFinalizeResult {
  job: AttachmentParseJobRecord;
  applied: boolean;
}

export interface ParserRuntimeAttachmentRecord {
  attachmentId: string;
  kind: "image" | "audio" | "video" | "document" | "other";
  mime?: string | null;
  storedPath?: string | null;
  fileName?: string | null;
  byteSize?: number | null;
  sha256?: string | null;
}

export interface ParserRuntimeCaptureRecord {
  captureId: string;
  attachments: ParserRuntimeAttachmentRecord[];
}

export interface ParserRuntimeStore {
  claimNextAttachmentParseJob(
    filters?: AttachmentParseJobClaimFilters,
  ): AttachmentParseJobRecord | null;
  requeueAttachmentParseJobs(filters?: RequeueAttachmentParseJobsInput): number;
  completeAttachmentParseJob(
    input: CompleteAttachmentParseJobInput,
  ): AttachmentParseJobFinalizeResult;
  failAttachmentParseJob(input: FailAttachmentParseJobInput): AttachmentParseJobFinalizeResult;
  getCapture(captureId: string): ParserRuntimeCaptureRecord | null;
}
