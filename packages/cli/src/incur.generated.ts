declare module 'incur' {
  interface Register {
    commands: {
      'allergy list': { args: {}; options: { vault: string; requestId?: string; status?: string; limit: number } }
      'allergy scaffold': { args: {}; options: { vault: string; requestId?: string } }
      'allergy show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'allergy upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'assistant ask': { args: { prompt: string }; options: { vault: string; requestId?: string; session?: string; alias?: string; channel?: string; identity?: string; participant?: string; sourceThread?: string; provider?: "codex-cli" | "openai-compatible"; codexCommand?: string; model?: string; baseUrl?: string; apiKeyEnv?: string; providerName?: string; headersJson?: string; sandbox?: "read-only" | "workspace-write" | "danger-full-access"; approvalPolicy?: "untrusted" | "on-request" | "never"; profile?: string; oss?: boolean; deliverResponse?: boolean; deliveryTarget?: string } }
      'assistant chat': { args: { prompt?: string }; options: { vault: string; requestId?: string; session?: string; alias?: string; channel?: string; identity?: string; participant?: string; sourceThread?: string; provider?: "codex-cli" | "openai-compatible"; codexCommand?: string; model?: string; baseUrl?: string; apiKeyEnv?: string; providerName?: string; headersJson?: string; sandbox?: "read-only" | "workspace-write" | "danger-full-access"; approvalPolicy?: "untrusted" | "on-request" | "never"; profile?: string; oss?: boolean } }
      'assistant deliver': { args: { message: string }; options: { vault: string; requestId?: string; session?: string; alias?: string; channel?: string; identity?: string; participant?: string; sourceThread?: string; deliveryTarget?: string } }
      'assistant doctor': { args: {}; options: { vault: string; requestId?: string; repair: boolean } }
      'assistant run': { args: {}; options: { vault: string; requestId?: string; model?: string; baseUrl?: string; apiKey?: string; apiKeyEnv?: string; providerName?: string; headersJson?: string; maxPerScan: number; allowSelfAuthored?: boolean; sessionRolloverHours?: number; once?: boolean; skipDaemon?: boolean } }
      'assistant self-target clear': { args: { channel?: string }; options: { requestId?: string } }
      'assistant self-target list': { args: {}; options: { requestId?: string } }
      'assistant self-target set': { args: { channel: string }; options: { requestId?: string; identity?: string; participant?: string; sourceThread?: string; deliveryTarget?: string } }
      'assistant self-target show': { args: { channel: string }; options: { requestId?: string } }
      'assistant session list': { args: {}; options: { vault: string; requestId?: string } }
      'assistant session show': { args: { sessionId: string }; options: { vault: string; requestId?: string } }
      'assistant status': { args: {}; options: { vault: string; requestId?: string; session?: string; limit: number } }
      'assistant stop': { args: {}; options: { vault: string; requestId?: string } }
      'audit list': { args: {}; options: { vault: string; requestId?: string; action?: string; actor?: string; status?: string; from?: string; to?: string; sort: "asc" | "desc"; limit: number } }
      'audit show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'audit tail': { args: {}; options: { vault: string; requestId?: string; limit: number } }
      'automation list': { args: {}; options: { vault: string; requestId?: string; status?: ("active" | "paused" | "archived")[]; text?: string; limit: number } }
      'automation scaffold': { args: {}; options: { vault: string; requestId?: string } }
      'automation show': { args: { lookup: string }; options: { vault: string; requestId?: string } }
      'automation upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'blood-test list': { args: {}; options: { vault: string; requestId?: string; status?: string; from?: string; to?: string; limit: number } }
      'blood-test scaffold': { args: {}; options: { vault: string; requestId?: string } }
      'blood-test show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'blood-test upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'chat': { args: { prompt?: string }; options: { vault: string; requestId?: string; session?: string; alias?: string; channel?: string; identity?: string; participant?: string; sourceThread?: string; provider?: "codex-cli" | "openai-compatible"; codexCommand?: string; model?: string; baseUrl?: string; apiKeyEnv?: string; providerName?: string; headersJson?: string; sandbox?: "read-only" | "workspace-write" | "danger-full-access"; approvalPolicy?: "untrusted" | "on-request" | "never"; profile?: string; oss?: boolean } }
      'condition list': { args: {}; options: { vault: string; requestId?: string; status?: string; limit: number } }
      'condition scaffold': { args: {}; options: { vault: string; requestId?: string } }
      'condition show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'condition upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'deepthink': { args: { prompt: string }; options: { vault: string; requestId?: string; title?: string; chat?: string; browserPath?: string; timeout?: string; waitTimeout?: string } }
      'device account disconnect': { args: { accountId: string }; options: { vault: string; requestId?: string; baseUrl?: string } }
      'device account list': { args: {}; options: { vault: string; requestId?: string; baseUrl?: string; provider?: string } }
      'device account reconcile': { args: { accountId: string }; options: { vault: string; requestId?: string; baseUrl?: string } }
      'device account show': { args: { accountId: string }; options: { vault: string; requestId?: string; baseUrl?: string } }
      'device connect': { args: { provider: string }; options: { vault: string; requestId?: string; baseUrl?: string; returnTo?: string; open?: boolean } }
      'device daemon start': { args: {}; options: { vault: string; requestId?: string; baseUrl?: string } }
      'device daemon status': { args: {}; options: { vault: string; requestId?: string; baseUrl?: string } }
      'device daemon stop': { args: {}; options: { vault: string; requestId?: string; baseUrl?: string } }
      'device provider list': { args: {}; options: { vault: string; requestId?: string; baseUrl?: string } }
      'doctor': { args: {}; options: { vault: string; requestId?: string; repair: boolean } }
      'document delete': { args: { id: string }; options: { vault: string; requestId?: string } }
      'document edit': { args: { id: string }; options: { vault: string; requestId?: string; input?: string; set?: string[]; clear?: string[]; dayKeyPolicy?: "keep" | "recompute" } }
      'document import': { args: { file: string }; options: { vault: string; requestId?: string; title?: string; occurredAt?: string; note?: string; source?: "manual" | "import" | "device" | "derived" } }
      'document list': { args: {}; options: { vault: string; requestId?: string; from?: string; to?: string } }
      'document manifest': { args: { id: string }; options: { vault: string; requestId?: string } }
      'document show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'event delete': { args: { id: string }; options: { vault: string; requestId?: string } }
      'event edit': { args: { id: string }; options: { vault: string; requestId?: string; input?: string; set?: string[]; clear?: string[]; dayKeyPolicy?: "keep" | "recompute" } }
      'event list': { args: {}; options: { vault: string; requestId?: string; kind?: string; from?: string; to?: string; tag?: string[]; experiment?: string; limit: number } }
      'event scaffold': { args: {}; options: { vault: string; requestId?: string; kind: "symptom" | "note" | "observation" | "medication_intake" | "supplement_intake" | "activity_session" | "body_measurement" | "sleep_session" | "intervention_session" } }
      'event show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'event upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'experiment checkpoint': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'experiment create': { args: { slug: string }; options: { vault: string; requestId?: string; title?: string; hypothesis?: string; startedOn?: string; status?: "planned" | "active" | "paused" | "completed" | "abandoned" } }
      'experiment list': { args: {}; options: { vault: string; requestId?: string; status?: "planned" | "active" | "paused" | "completed" | "abandoned"; limit: number } }
      'experiment show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'experiment stop': { args: { id: string }; options: { vault: string; requestId?: string; occurredAt?: string; note?: string } }
      'experiment update': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'export pack create': { args: {}; options: { vault: string; requestId?: string; from: string; to: string; experiment?: string; out?: string } }
      'export pack list': { args: {}; options: { vault: string; requestId?: string; from?: string; to?: string; experiment?: string; limit: number } }
      'export pack materialize': { args: { id: string }; options: { vault: string; requestId?: string; out?: string } }
      'export pack prune': { args: { id: string }; options: { vault: string; requestId?: string } }
      'export pack show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'family list': { args: {}; options: { vault: string; requestId?: string; limit: number } }
      'family scaffold': { args: {}; options: { vault: string; requestId?: string } }
      'family show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'family upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'food delete': { args: { id: string }; options: { vault: string; requestId?: string } }
      'food edit': { args: { id: string }; options: { vault: string; requestId?: string; input?: string; set?: string[]; clear?: string[] } }
      'food list': { args: {}; options: { vault: string; requestId?: string; status?: "active" | "archived"; limit: number } }
      'food rename': { args: { lookup: string }; options: { vault: string; requestId?: string; title: string; slug?: string } }
      'food scaffold': { args: {}; options: { vault: string; requestId?: string } }
      'food schedule': { args: { title: string }; options: { vault: string; requestId?: string; time: string; note?: string; slug?: string } }
      'food show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'food upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'genetics list': { args: {}; options: { vault: string; requestId?: string; status?: string; limit: number } }
      'genetics scaffold': { args: {}; options: { vault: string; requestId?: string } }
      'genetics show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'genetics upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'goal list': { args: {}; options: { vault: string; requestId?: string; status?: string; limit: number } }
      'goal scaffold': { args: {}; options: { vault: string; requestId?: string } }
      'goal show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'goal upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'inbox attachment list': { args: { captureId: string }; options: { vault: string; requestId?: string } }
      'inbox attachment parse': { args: { attachmentId: string }; options: { vault: string; requestId?: string } }
      'inbox attachment reparse': { args: { attachmentId: string }; options: { vault: string; requestId?: string } }
      'inbox attachment show': { args: { attachmentId: string }; options: { vault: string; requestId?: string } }
      'inbox attachment show-status': { args: { attachmentId: string }; options: { vault: string; requestId?: string } }
      'inbox backfill': { args: {}; options: { vault: string; requestId?: string; source: string; limit?: number; parse?: boolean } }
      'inbox bootstrap': { args: {}; options: { vault: string; requestId?: string; rebuild?: boolean; ffmpegCommand?: string; pdftotextCommand?: string; whisperCommand?: string; whisperModelPath?: string; strict?: boolean } }
      'inbox doctor': { args: { sourceId?: string }; options: { vault: string; requestId?: string } }
      'inbox init': { args: {}; options: { vault: string; requestId?: string; rebuild?: boolean } }
      'inbox list': { args: {}; options: { vault: string; requestId?: string; source?: string; limit: number } }
      'inbox model bundle': { args: { captureId: string }; options: { vault: string; requestId?: string } }
      'inbox model route': { args: { captureId: string }; options: { vault: string; requestId?: string; model: string; baseUrl?: string; apiKey?: string; apiKeyEnv?: string; providerName?: string; headersJson?: string; apply?: boolean } }
      'inbox parse': { args: {}; options: { vault: string; requestId?: string; captureId?: string; limit?: number } }
      'inbox promote document': { args: { captureId: string }; options: { vault: string; requestId?: string } }
      'inbox promote experiment-note': { args: { captureId: string }; options: { vault: string; requestId?: string } }
      'inbox promote journal': { args: { captureId: string }; options: { vault: string; requestId?: string } }
      'inbox promote meal': { args: { captureId: string }; options: { vault: string; requestId?: string } }
      'inbox requeue': { args: {}; options: { vault: string; requestId?: string; captureId?: string; attachmentId?: string; state: "failed" | "running" } }
      'inbox run': { args: {}; options: { vault: string; requestId?: string } }
      'inbox search': { args: {}; options: { vault: string; requestId?: string; text: string; source?: string; limit: number } }
      'inbox setup': { args: {}; options: { vault: string; requestId?: string; ffmpegCommand?: string; pdftotextCommand?: string; whisperCommand?: string; whisperModelPath?: string } }
      'inbox show': { args: { captureId: string }; options: { vault: string; requestId?: string } }
      'inbox source add': { args: { source: "imessage" | "telegram" | "email" | "linq" }; options: { vault: string; requestId?: string; id: string; account?: string; address?: string; includeOwn?: boolean; backfillLimit: number; provision?: boolean; emailDisplayName?: string; emailUsername?: string; emailDomain?: string; emailClientId?: string; linqWebhookHost?: string; linqWebhookPath?: string; linqWebhookPort?: number; enableAutoReply?: boolean } }
      'inbox source list': { args: {}; options: { vault: string; requestId?: string } }
      'inbox source remove': { args: { id: string }; options: { vault: string; requestId?: string } }
      'inbox status': { args: {}; options: { vault: string; requestId?: string } }
      'inbox stop': { args: {}; options: { vault: string; requestId?: string } }
      'init': { args: {}; options: { vault: string; requestId?: string; timezone?: string } }
      'intake import': { args: { file: string }; options: { vault: string; requestId?: string; title?: string; occurredAt?: string; importedAt?: string; source?: "import" | "manual" | "derived" } }
      'intake list': { args: {}; options: { vault: string; requestId?: string; from?: string; to?: string; limit: number } }
      'intake manifest': { args: { id: string }; options: { vault: string; requestId?: string } }
      'intake project': { args: { id: string }; options: { vault: string; requestId?: string } }
      'intake raw': { args: { id: string }; options: { vault: string; requestId?: string } }
      'intake show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'intervention add': { args: { text: string }; options: { vault: string; requestId?: string; duration?: number; type?: string; protocolId?: string; occurredAt?: string; source?: "manual" | "import" | "device" | "derived" } }
      'intervention delete': { args: { id: string }; options: { vault: string; requestId?: string } }
      'intervention edit': { args: { id: string }; options: { vault: string; requestId?: string; input?: string; set?: string[]; clear?: string[]; dayKeyPolicy?: "keep" | "recompute" } }
      'journal append': { args: { date: string }; options: { vault: string; requestId?: string; text: string } }
      'journal ensure': { args: { date: string }; options: { vault: string; requestId?: string } }
      'journal link': { args: { date: string }; options: { vault: string; requestId?: string; eventId?: string[]; stream?: string[] } }
      'journal list': { args: {}; options: { vault: string; requestId?: string; from?: string; to?: string; limit: number } }
      'journal show': { args: { date: string }; options: { vault: string; requestId?: string } }
      'journal unlink': { args: { date: string }; options: { vault: string; requestId?: string; eventId?: string[]; stream?: string[] } }
      'knowledge index rebuild': { args: {}; options: { vault: string; requestId?: string } }
      'knowledge lint': { args: {}; options: { vault: string; requestId?: string } }
      'knowledge list': { args: {}; options: { vault: string; requestId?: string; pageType?: string; status?: string } }
      'knowledge log tail': { args: {}; options: { vault: string; requestId?: string; limit: number } }
      'knowledge search': { args: { query: string }; options: { vault: string; requestId?: string; pageType?: string; status?: string; limit?: number } }
      'knowledge show': { args: { slug: string }; options: { vault: string; requestId?: string } }
      'knowledge upsert': { args: {}; options: { vault: string; requestId?: string; body: string; title?: string; slug?: string; pageType?: string; status?: string; clearLibraryLinks?: boolean; relatedSlug?: string[]; librarySlug?: string[]; sourcePath?: string[] } }
      'list': { args: {}; options: { vault: string; requestId?: string; recordType?: string[]; kind?: string; status?: string; stream?: string[]; experiment?: string; from?: string; to?: string; tag?: string[]; limit: number } }
      'meal add': { args: {}; options: { vault: string; requestId?: string; photo?: string; audio?: string; note?: string; occurredAt?: string; source?: "manual" | "import" | "device" | "derived" } }
      'meal delete': { args: { id: string }; options: { vault: string; requestId?: string } }
      'meal edit': { args: { id: string }; options: { vault: string; requestId?: string; input?: string; set?: string[]; clear?: string[]; dayKeyPolicy?: "keep" | "recompute" } }
      'meal list': { args: {}; options: { vault: string; requestId?: string; from?: string; to?: string } }
      'meal manifest': { args: { id: string }; options: { vault: string; requestId?: string } }
      'meal show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'memory forget': { args: { memoryId: string }; options: { vault: string } }
      'memory show': { args: { memoryId?: string }; options: { vault: string } }
      'memory update': { args: { memoryId: string; text: string }; options: { vault: string; section?: "Identity" | "Preferences" | "Instructions" | "Context" } }
      'memory upsert': { args: { text: string }; options: { vault: string; section: "Identity" | "Preferences" | "Instructions" | "Context" } }
      'model': { args: {}; options: { show?: boolean; preset?: "codex" | "openai-compatible"; providerPreset?: "openai" | "vercel-ai-gateway" | "openrouter" | "venice" | "deepseek" | "groq" | "together" | "fireworks" | "cerebras" | "xai" | "huggingface" | "nvidia" | "ollama" | "lm-studio" | "vllm" | "litellm" | "custom"; model?: string; baseUrl?: string; apiKeyEnv?: string; providerName?: string; zeroDataRetention?: boolean; codexCommand?: string; profile?: string; reasoningEffort?: "low" | "medium" | "high" | "xhigh"; oss?: boolean } }
      'protocol list': { args: {}; options: { vault: string; requestId?: string; status?: string; limit: number } }
      'protocol scaffold': { args: {}; options: { vault: string; requestId?: string } }
      'protocol show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'protocol stop': { args: { protocolId: string }; options: { vault: string; requestId?: string; stoppedOn?: string } }
      'protocol upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'provider delete': { args: { id: string }; options: { vault: string; requestId?: string } }
      'provider edit': { args: { id: string }; options: { vault: string; requestId?: string; input?: string; set?: string[]; clear?: string[] } }
      'provider list': { args: {}; options: { vault: string; requestId?: string; status?: string; limit: number } }
      'provider scaffold': { args: {}; options: { vault: string; requestId?: string } }
      'provider show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'provider upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'query projection rebuild': { args: {}; options: { vault: string; requestId?: string } }
      'query projection status': { args: {}; options: { vault: string; requestId?: string } }
      'recipe delete': { args: { id: string }; options: { vault: string; requestId?: string } }
      'recipe edit': { args: { id: string }; options: { vault: string; requestId?: string; input?: string; set?: string[]; clear?: string[] } }
      'recipe list': { args: {}; options: { vault: string; requestId?: string; status?: "draft" | "saved" | "archived"; limit: number } }
      'recipe scaffold': { args: {}; options: { vault: string; requestId?: string } }
      'recipe show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'recipe upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'research': { args: { prompt: string }; options: { vault: string; requestId?: string; title?: string; chat?: string; browserPath?: string; timeout?: string; waitTimeout?: string } }
      'run': { args: {}; options: { vault: string; requestId?: string; model?: string; baseUrl?: string; apiKey?: string; apiKeyEnv?: string; providerName?: string; headersJson?: string; maxPerScan: number; allowSelfAuthored?: boolean; sessionRolloverHours?: number; once?: boolean; skipDaemon?: boolean } }
      'samples add': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'samples batch list': { args: {}; options: { vault: string; requestId?: string; stream?: string; from?: string; to?: string; limit: number } }
      'samples batch show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'samples import-csv': { args: { file: string }; options: { vault: string; requestId?: string; preset?: string; stream?: string; tsColumn?: string; valueColumn?: string; unit?: string; delimiter?: string; metadataColumns?: string[]; source?: string } }
      'samples list': { args: {}; options: { vault: string; requestId?: string; stream?: string; from?: string; to?: string; quality?: string; limit: number } }
      'samples show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'search query': { args: {}; options: { vault: string; requestId?: string; text: string; recordType?: string[]; kind?: string[]; stream?: string[]; experiment?: string; from?: string; to?: string; tag?: string[]; limit: number } }
      'show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'status': { args: {}; options: { vault: string; requestId?: string; session?: string; limit: number } }
      'stop': { args: {}; options: { vault: string; requestId?: string } }
      'supplement compound list': { args: {}; options: { vault: string; requestId?: string; limit: number; status?: string } }
      'supplement compound show': { args: { compound: string }; options: { vault: string; requestId?: string; status?: string } }
      'supplement list': { args: {}; options: { vault: string; requestId?: string; status?: string; limit: number } }
      'supplement rename': { args: { lookup: string }; options: { vault: string; requestId?: string; title: string; slug?: string } }
      'supplement scaffold': { args: {}; options: { vault: string; requestId?: string } }
      'supplement show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'supplement stop': { args: { id: string }; options: { vault: string; requestId?: string; stoppedOn?: string } }
      'supplement upsert': { args: {}; options: { vault: string; requestId?: string; input: string } }
      'timeline': { args: {}; options: { vault: string; requestId?: string; from?: string; to?: string; experiment?: string; kind?: string[]; stream?: string[]; entryType?: string[]; limit: number } }
      'validate': { args: {}; options: { vault: string; requestId?: string } }
      'vault repair': { args: {}; options: { vault: string; requestId?: string } }
      'vault show': { args: {}; options: { vault: string; requestId?: string } }
      'vault stats': { args: {}; options: { vault: string; requestId?: string } }
      'vault update': { args: {}; options: { vault: string; requestId?: string; title?: string; timezone?: string } }
      'wearables activity list': { args: {}; options: { vault: string; requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; limit: number } }
      'wearables body list': { args: {}; options: { vault: string; requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; limit: number } }
      'wearables day': { args: {}; options: { vault: string; requestId?: string; date: string; provider?: string[] } }
      'wearables recovery list': { args: {}; options: { vault: string; requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; limit: number } }
      'wearables sleep list': { args: {}; options: { vault: string; requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; limit: number } }
      'wearables sources list': { args: {}; options: { vault: string; requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; limit: number } }
      'workout add': { args: { text?: string }; options: { vault: string; requestId?: string; input?: string; duration?: number; type?: string; distanceKm?: number; occurredAt?: string; source?: "manual" | "import" | "device" | "derived"; media?: string[] } }
      'workout delete': { args: { id: string }; options: { vault: string; requestId?: string } }
      'workout edit': { args: { id: string }; options: { vault: string; requestId?: string; input?: string; set?: string[]; clear?: string[]; dayKeyPolicy?: "keep" | "recompute" } }
      'workout format list': { args: {}; options: { vault: string; requestId?: string; limit: number } }
      'workout format log': { args: { name: string }; options: { vault: string; requestId?: string; duration?: number; type?: string; distanceKm?: number; occurredAt?: string; source?: "manual" | "import" | "device" | "derived"; media?: string[] } }
      'workout format save': { args: { name?: string; text?: string }; options: { vault: string; requestId?: string; input?: string; duration?: number; type?: string; distanceKm?: number } }
      'workout format show': { args: { name: string }; options: { vault: string; requestId?: string } }
      'workout import csv': { args: { file: string }; options: { vault: string; requestId?: string; source?: string; delimiter?: string; storeRawOnly?: boolean } }
      'workout import inspect': { args: { file: string }; options: { vault: string; requestId?: string; source?: string; delimiter?: string } }
      'workout list': { args: {}; options: { vault: string; requestId?: string; from?: string; to?: string; limit: number } }
      'workout manifest': { args: { id: string }; options: { vault: string; requestId?: string } }
      'workout measurement add': { args: {}; options: { vault: string; requestId?: string; input?: string; type?: "weight" | "body_fat_pct" | "waist" | "neck" | "shoulders" | "chest" | "biceps" | "forearms" | "abdomen" | "hips" | "thighs" | "calves"; value?: number; unit?: "lb" | "kg" | "percent" | "cm" | "in"; note?: string; title?: string; occurredAt?: string; source?: "manual" | "import" | "device" | "derived"; media?: string[] } }
      'workout measurement list': { args: {}; options: { vault: string; requestId?: string; from?: string; to?: string; limit: number } }
      'workout measurement manifest': { args: { id: string }; options: { vault: string; requestId?: string } }
      'workout measurement show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'workout show': { args: { id: string }; options: { vault: string; requestId?: string } }
      'workout units set': { args: {}; options: { vault: string; requestId?: string; weight?: "lb" | "kg"; bodyMeasurement?: "cm" | "in"; recordedAt?: string } }
      'workout units show': { args: {}; options: { vault: string; requestId?: string } }
    }
  }
}
