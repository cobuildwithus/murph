declare module 'incur' {
  interface Register {
    commands: {
      'allergy list': { args: {}; options: { vault: string; requestId: string; status: string; limit: number } }
      'allergy scaffold': { args: {}; options: { vault: string; requestId: string } }
      'allergy show': { args: { id: string }; options: { vault: string; requestId: string } }
      'allergy upsert': { args: {}; options: { vault: string; requestId: string; input: string } }
      'assistant ask': { args: { prompt: string }; options: { vault: string; requestId: string; session: string; alias: string; channel: string; identity: string; participant: string; sourceThread: string; provider: "codex-cli" | "openai-compatible"; codexCommand: string; model: string; baseUrl: string; apiKeyEnv: string; providerName: string; sandbox: "read-only" | "workspace-write" | "danger-full-access"; approvalPolicy: "untrusted" | "on-request" | "never"; profile: string; oss: boolean; deliverResponse: boolean; deliveryTarget: string } }
      'assistant chat': { args: { prompt: string }; options: { vault: string; requestId: string; session: string; alias: string; channel: string; identity: string; participant: string; sourceThread: string; provider: "codex-cli" | "openai-compatible"; codexCommand: string; model: string; baseUrl: string; apiKeyEnv: string; providerName: string; sandbox: "read-only" | "workspace-write" | "danger-full-access"; approvalPolicy: "untrusted" | "on-request" | "never"; profile: string; oss: boolean } }
      'assistant deliver': { args: { message: string }; options: { vault: string; requestId: string; session: string; alias: string; channel: string; identity: string; participant: string; sourceThread: string; deliveryTarget: string } }
      'assistant cron add': { args: { prompt: string }; options: { vault: string; requestId: string; name: string; at: string; every: string; cron: string; keepAfterRun: boolean; disabled: boolean; session: string; alias: string; channel: string; identity: string; participant: string; sourceThread: string; deliverResponse: boolean; deliveryTarget: string } }
      'assistant cron disable': { args: { job: string }; options: { vault: string; requestId: string } }
      'assistant cron enable': { args: { job: string }; options: { vault: string; requestId: string } }
      'assistant cron list': { args: {}; options: { vault: string; requestId: string } }
      'assistant cron remove': { args: { job: string }; options: { vault: string; requestId: string } }
      'assistant cron run': { args: { job: string }; options: { vault: string; requestId: string } }
      'assistant cron runs': { args: { job: string }; options: { vault: string; requestId: string; limit: number } }
      'assistant cron show': { args: { job: string }; options: { vault: string; requestId: string } }
      'assistant cron status': { args: {}; options: { vault: string; requestId: string } }
      'assistant memory forget': { args: { memoryId: string }; options: { vault: string; requestId: string } }
      'assistant memory get': { args: { memoryId: string }; options: { vault: string; requestId: string } }
      'assistant memory search': { args: {}; options: { vault: string; requestId: string; text: string; scope: "long-term" | "daily" | "all"; section: "Identity" | "Preferences" | "Standing instructions" | "Health context" | "Notes"; limit: number } }
      'assistant memory upsert': { args: { text: string }; options: { vault: string; requestId: string; scope: "long-term" | "daily" | "both"; section: "Identity" | "Preferences" | "Standing instructions" | "Health context"; sourcePrompt: string } }
      'assistant run': { args: {}; options: { vault: string; requestId: string; model: string; baseUrl: string; apiKey: string; apiKeyEnv: string; providerName: string; headersJson: string; scanIntervalMs: number; maxPerScan: number; allowSelfAuthored: boolean; sessionRolloverHours: number; once: boolean; skipDaemon: boolean } }
      'assistant session list': { args: {}; options: { vault: string; requestId: string } }
      'assistant session show': { args: { sessionId: string }; options: { vault: string; requestId: string } }
      'audit list': { args: {}; options: { vault: string; requestId: string; action: string; actor: string; status: string; from: string; to: string; sort: "asc" | "desc"; limit: number } }
      'audit show': { args: { id: string }; options: { vault: string; requestId: string } }
      'audit tail': { args: {}; options: { vault: string; requestId: string; limit: number } }
      'chat': { args: { prompt: string }; options: { vault: string; requestId: string; session: string; alias: string; channel: string; identity: string; participant: string; sourceThread: string; provider: "codex-cli" | "openai-compatible"; codexCommand: string; model: string; baseUrl: string; apiKeyEnv: string; providerName: string; sandbox: "read-only" | "workspace-write" | "danger-full-access"; approvalPolicy: "untrusted" | "on-request" | "never"; profile: string; oss: boolean } }
      'condition list': { args: {}; options: { vault: string; requestId: string; status: string; limit: number } }
      'condition scaffold': { args: {}; options: { vault: string; requestId: string } }
      'condition show': { args: { id: string }; options: { vault: string; requestId: string } }
      'condition upsert': { args: {}; options: { vault: string; requestId: string; input: string } }
      'device account disconnect': { args: { accountId: string }; options: { vault: string; requestId: string; baseUrl: string } }
      'device account list': { args: {}; options: { vault: string; requestId: string; baseUrl: string; provider: string } }
      'device account reconcile': { args: { accountId: string }; options: { vault: string; requestId: string; baseUrl: string } }
      'device account show': { args: { accountId: string }; options: { vault: string; requestId: string; baseUrl: string } }
      'device connect': { args: { provider: string }; options: { vault: string; requestId: string; baseUrl: string; returnTo: string; open: boolean } }
      'device daemon start': { args: {}; options: { vault: string; requestId: string; baseUrl: string } }
      'device daemon status': { args: {}; options: { vault: string; requestId: string; baseUrl: string } }
      'device daemon stop': { args: {}; options: { vault: string; requestId: string; baseUrl: string } }
      'device provider list': { args: {}; options: { vault: string; requestId: string; baseUrl: string } }
      'document import': { args: { file: string }; options: { vault: string; requestId: string; title: string; occurredAt: string; note: string; source: "manual" | "import" | "device" | "derived" } }
      'document list': { args: {}; options: { vault: string; requestId: string; from: string; to: string } }
      'document manifest': { args: { id: string }; options: { vault: string; requestId: string } }
      'document show': { args: { id: string }; options: { vault: string; requestId: string } }
      'event list': { args: {}; options: { vault: string; requestId: string; kind: string; from: string; to: string; tag: string[]; experiment: string; limit: number } }
      'event scaffold': { args: {}; options: { vault: string; requestId: string; kind: "symptom" | "note" | "observation" | "medication_intake" | "supplement_intake" | "activity_session" | "sleep_session" } }
      'event show': { args: { id: string }; options: { vault: string; requestId: string } }
      'event upsert': { args: {}; options: { vault: string; requestId: string; input: string } }
      'experiment checkpoint': { args: {}; options: { vault: string; requestId: string; input: string } }
      'experiment create': { args: { slug: string }; options: { vault: string; requestId: string; title: string; hypothesis: string; startedOn: string; status: "planned" | "active" | "paused" | "completed" | "abandoned" } }
      'experiment list': { args: {}; options: { vault: string; requestId: string; status: "planned" | "active" | "paused" | "completed" | "abandoned"; limit: number } }
      'experiment show': { args: { id: string }; options: { vault: string; requestId: string } }
      'experiment stop': { args: { id: string }; options: { vault: string; requestId: string; occurredAt: string; note: string } }
      'experiment update': { args: {}; options: { vault: string; requestId: string; input: string } }
      'export pack create': { args: {}; options: { vault: string; requestId: string; from: string; to: string; experiment: string; out: string } }
      'export pack list': { args: {}; options: { vault: string; requestId: string; from: string; to: string; experiment: string; limit: number } }
      'export pack materialize': { args: { id: string }; options: { vault: string; requestId: string; out: string } }
      'export pack prune': { args: { id: string }; options: { vault: string; requestId: string } }
      'export pack show': { args: { id: string }; options: { vault: string; requestId: string } }
      'family list': { args: {}; options: { vault: string; requestId: string; status: string; limit: number } }
      'family scaffold': { args: {}; options: { vault: string; requestId: string } }
      'family show': { args: { id: string }; options: { vault: string; requestId: string } }
      'family upsert': { args: {}; options: { vault: string; requestId: string; input: string } }
      'genetics list': { args: {}; options: { vault: string; requestId: string; status: string; limit: number } }
      'genetics scaffold': { args: {}; options: { vault: string; requestId: string } }
      'genetics show': { args: { id: string }; options: { vault: string; requestId: string } }
      'genetics upsert': { args: {}; options: { vault: string; requestId: string; input: string } }
      'goal list': { args: {}; options: { vault: string; requestId: string; status: string; limit: number } }
      'goal scaffold': { args: {}; options: { vault: string; requestId: string } }
      'goal show': { args: { id: string }; options: { vault: string; requestId: string } }
      'goal upsert': { args: {}; options: { vault: string; requestId: string; input: string } }
      'history list': { args: {}; options: { vault: string; requestId: string; status: string; kind: string; from: string; to: string; limit: number } }
      'history scaffold': { args: {}; options: { vault: string; requestId: string } }
      'history show': { args: { id: string }; options: { vault: string; requestId: string } }
      'history upsert': { args: {}; options: { vault: string; requestId: string; input: string } }
      'inbox attachment list': { args: { captureId: string }; options: { vault: string; requestId: string } }
      'inbox attachment parse': { args: { attachmentId: string }; options: { vault: string; requestId: string } }
      'inbox attachment reparse': { args: { attachmentId: string }; options: { vault: string; requestId: string } }
      'inbox attachment show': { args: { attachmentId: string }; options: { vault: string; requestId: string } }
      'inbox attachment show-status': { args: { attachmentId: string }; options: { vault: string; requestId: string } }
      'inbox backfill': { args: {}; options: { vault: string; requestId: string; source: string; limit: number; parse: boolean } }
      'inbox bootstrap': { args: {}; options: { vault: string; requestId: string; rebuild: boolean; ffmpegCommand: string; pdftotextCommand: string; whisperCommand: string; whisperModelPath: string; paddleocrCommand: string; strict: boolean } }
      'inbox doctor': { args: { sourceId: string }; options: { vault: string; requestId: string } }
      'inbox init': { args: {}; options: { vault: string; requestId: string; rebuild: boolean } }
      'inbox list': { args: {}; options: { vault: string; requestId: string; source: string; limit: number } }
      'inbox model bundle': { args: { captureId: string }; options: { vault: string; requestId: string } }
      'inbox model route': { args: { captureId: string }; options: { vault: string; requestId: string; model: string; baseUrl: string; apiKey: string; apiKeyEnv: string; providerName: string; headersJson: string; apply: boolean } }
      'inbox parse': { args: {}; options: { vault: string; requestId: string; captureId: string; limit: number } }
      'inbox promote document': { args: { captureId: string }; options: { vault: string; requestId: string } }
      'inbox promote experiment-note': { args: { captureId: string }; options: { vault: string; requestId: string } }
      'inbox promote journal': { args: { captureId: string }; options: { vault: string; requestId: string } }
      'inbox promote meal': { args: { captureId: string }; options: { vault: string; requestId: string } }
      'inbox requeue': { args: {}; options: { vault: string; requestId: string; captureId: string; attachmentId: string; state: "failed" | "running" } }
      'inbox run': { args: {}; options: { vault: string; requestId: string } }
      'inbox search': { args: {}; options: { vault: string; requestId: string; text: string; source: string; limit: number } }
      'inbox setup': { args: {}; options: { vault: string; requestId: string; ffmpegCommand: string; pdftotextCommand: string; whisperCommand: string; whisperModelPath: string; paddleocrCommand: string } }
      'inbox show': { args: { captureId: string }; options: { vault: string; requestId: string } }
      'inbox source add': { args: { source: "imessage" | "telegram" | "email" }; options: { vault: string; requestId: string; id: string; account: string; address: string; includeOwn: boolean; backfillLimit: number; provision: boolean; emailDisplayName: string; emailUsername: string; emailDomain: string; emailClientId: string; enableAutoReply: boolean } }
      'inbox source list': { args: {}; options: { vault: string; requestId: string } }
      'inbox source remove': { args: { id: string }; options: { vault: string; requestId: string } }
      'inbox status': { args: {}; options: { vault: string; requestId: string } }
      'inbox stop': { args: {}; options: { vault: string; requestId: string } }
      'init': { args: {}; options: { vault: string; requestId: string } }
      'intake import': { args: { file: string }; options: { vault: string; requestId: string; title: string; occurredAt: string; importedAt: string; source: "import" | "manual" | "derived" } }
      'intake list': { args: {}; options: { vault: string; requestId: string; from: string; to: string; limit: number } }
      'intake manifest': { args: { id: string }; options: { vault: string; requestId: string } }
      'intake project': { args: { id: string }; options: { vault: string; requestId: string } }
      'intake raw': { args: { id: string }; options: { vault: string; requestId: string } }
      'intake show': { args: { id: string }; options: { vault: string; requestId: string } }
      'journal append': { args: { date: string }; options: { vault: string; requestId: string; text: string } }
      'journal ensure': { args: { date: string }; options: { vault: string; requestId: string } }
      'journal link': { args: { date: string }; options: { vault: string; requestId: string; eventId: string[]; stream: string[] } }
      'journal list': { args: {}; options: { vault: string; requestId: string; from: string; to: string; limit: number } }
      'journal show': { args: { date: string }; options: { vault: string; requestId: string } }
      'journal unlink': { args: { date: string }; options: { vault: string; requestId: string; eventId: string[]; stream: string[] } }
      'list': { args: {}; options: { vault: string; requestId: string; recordType: string[]; kind: string; status: string; stream: string[]; experiment: string; from: string; to: string; tag: string[]; limit: number } }
      'meal add': { args: {}; options: { vault: string; requestId: string; photo: string; audio: string; note: string; occurredAt: string; source: "manual" | "import" | "device" | "derived" } }
      'meal list': { args: {}; options: { vault: string; requestId: string; from: string; to: string } }
      'meal manifest': { args: { id: string }; options: { vault: string; requestId: string } }
      'meal show': { args: { id: string }; options: { vault: string; requestId: string } }
      'profile current rebuild': { args: {}; options: { vault: string; requestId: string } }
      'profile list': { args: {}; options: { vault: string; requestId: string; from: string; to: string; limit: number } }
      'profile scaffold': { args: {}; options: { vault: string; requestId: string } }
      'profile show': { args: { id: string }; options: { vault: string; requestId: string } }
      'profile upsert': { args: {}; options: { vault: string; requestId: string; input: string } }
      'provider list': { args: {}; options: { vault: string; requestId: string; status: string; limit: number } }
      'provider scaffold': { args: {}; options: { vault: string; requestId: string } }
      'provider show': { args: { id: string }; options: { vault: string; requestId: string } }
      'provider upsert': { args: {}; options: { vault: string; requestId: string; input: string } }
      'regimen list': { args: {}; options: { vault: string; requestId: string; status: string; limit: number } }
      'regimen scaffold': { args: {}; options: { vault: string; requestId: string } }
      'regimen show': { args: { id: string }; options: { vault: string; requestId: string } }
      'regimen stop': { args: { regimenId: string }; options: { vault: string; requestId: string; stoppedOn: string } }
      'regimen upsert': { args: {}; options: { vault: string; requestId: string; input: string } }
      'run': { args: {}; options: { vault: string; requestId: string; model: string; baseUrl: string; apiKey: string; apiKeyEnv: string; providerName: string; headersJson: string; scanIntervalMs: number; maxPerScan: number; allowSelfAuthored: boolean; sessionRolloverHours: number; once: boolean; skipDaemon: boolean } }
      'samples add': { args: {}; options: { vault: string; requestId: string; input: string } }
      'samples batch list': { args: {}; options: { vault: string; requestId: string; stream: string; from: string; to: string; limit: number } }
      'samples batch show': { args: { id: string }; options: { vault: string; requestId: string } }
      'samples import-csv': { args: { file: string }; options: { vault: string; requestId: string; preset: string; stream: string; tsColumn: string; valueColumn: string; unit: string; delimiter: string; metadataColumns: string[]; source: string } }
      'samples list': { args: {}; options: { vault: string; requestId: string; stream: string; from: string; to: string; quality: string; limit: number } }
      'samples show': { args: { id: string }; options: { vault: string; requestId: string } }
      'search index rebuild': { args: {}; options: { vault: string; requestId: string } }
      'search index status': { args: {}; options: { vault: string; requestId: string } }
      'search query': { args: {}; options: { vault: string; requestId: string; text: string; backend: "auto" | "scan" | "sqlite"; recordType: string[]; kind: string[]; stream: string[]; experiment: string; from: string; to: string; tag: string[]; limit: number } }
      'show': { args: { id: string }; options: { vault: string; requestId: string } }
      'timeline': { args: {}; options: { vault: string; requestId: string; from: string; to: string; experiment: string; kind: string[]; stream: string[]; entryType: string[]; limit: number } }
      'validate': { args: {}; options: { vault: string; requestId: string } }
      'vault paths': { args: {}; options: { vault: string; requestId: string } }
      'vault show': { args: {}; options: { vault: string; requestId: string } }
      'vault stats': { args: {}; options: { vault: string; requestId: string } }
      'vault update': { args: {}; options: { vault: string; requestId: string; title: string; timezone: string } }
      'workout add': { args: { text: string }; options: { vault: string; requestId: string; duration: number; type: string; distanceKm: number; occurredAt: string; source: "manual" | "import" | "device" | "derived" } }
    }
  }
}
