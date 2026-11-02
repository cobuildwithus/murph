import type {
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeStore,
} from '../inbox-app/types.js'
import {
  isParseableAttachment,
  resolveAttachmentParseState,
} from './shared.js'

export function buildAttachmentParseStatus(input: {
  runtime: RuntimeStore
  listAttachmentParseJobs: RuntimeStore['listAttachmentParseJobs']
  captureId: string
  attachmentId: string
  fallbackAttachment: RuntimeAttachmentRecord
}) {
  const attachment = refreshAttachmentForCapture(
    input.runtime,
    input.captureId,
    input.attachmentId,
    input.fallbackAttachment,
  )
  if (!isParseableAttachment(attachment)) {
    return {
      currentState: null,
      jobs: [],
    }
  }

  const jobs = input.listAttachmentParseJobs({
    attachmentId: input.attachmentId,
    limit: 20,
  })

  return {
    currentState: resolveAttachmentParseState(attachment, jobs),
    jobs: jobs.map(toCliAttachmentParseJob),
  }
}

function refreshAttachmentForCapture(
  runtime: RuntimeStore,
  captureId: string,
  attachmentId: string,
  fallbackAttachment: RuntimeAttachmentRecord,
): RuntimeAttachmentRecord {
  return (
    runtime
      .getCapture(captureId)
      ?.attachments.find(
        (attachment) => attachment.attachmentId === attachmentId,
      ) ?? fallbackAttachment
  )
}

function toCliAttachmentParseJob(job: RuntimeAttachmentParseJobRecord) {
  return {
    jobId: job.jobId,
    captureId: job.captureId,
    attachmentId: job.attachmentId,
    pipeline: job.pipeline,
    state: job.state,
    attempts: job.attempts,
    providerId: job.providerId ?? null,
    resultPath: job.resultPath ?? null,
    errorCode: job.errorCode ?? null,
    errorMessage: job.errorMessage ?? null,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
  }
}

export { isParseableAttachment }
