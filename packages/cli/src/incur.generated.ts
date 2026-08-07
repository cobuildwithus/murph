declare module 'incur' {
  interface Register {
    commands: {
      'age calculate': { args: {}; options: { input: string; mode: "product" | "research"; modelCardArtifactRoot?: string } }
      'age calculate-bundle': { args: {}; options: { input: string; includeResearchPreview: boolean; modelCardArtifactRoot?: string } }
      'age evidence': { args: {}; options: { input?: string; includeTemplates: boolean; includeBenchmarkCards: boolean; includeNsrrRequests: boolean } }
      'age inputs': { args: {}; options: { requestId?: string; asOf: string } }
      'age model-cards': { args: {}; options: { requestId?: string; modelCardArtifactRoot?: string } }
      'age preview': { args: {}; options: { input: string; modelCardArtifactRoot?: string } }
      'age preview-view': { args: {}; options: { input: string; modelCardArtifactRoot?: string } }
      'age report': { args: {}; options: { requestId?: string; asOf: string; chronologicalAgeYears: number; sex: "female" | "male"; mode: "product" | "research"; cardId?: "l1b_glycemia_body_10y_acm_research" | "l1_tiny_glycemia_10y_acm_research" | "lab5_bp_bmi_transport_research" | "lab9_bp_body_10y_acm_research" | "r399_nhis_proxy_10y_acm_research"; modelCardArtifactRoot?: string } }
      'age scaffold': { args: {}; options: {} }
      'allergy import-json': { args: {}; options: { requestId?: string; input: string } }
      'allergy list': { args: {}; options: { requestId?: string; status?: string; limit: number } }
      'allergy save': { args: { title: string }; options: { requestId?: string; id?: string; slug?: string; substance: string; status?: "active" | "inactive" | "resolved"; criticality?: "low" | "high" | "unable_to_assess"; reaction?: string; recordedOn?: string; relatedConditionId?: string[]; note?: string } }
      'allergy scaffold': { args: {}; options: { requestId?: string } }
      'allergy show': { args: { id: string }; options: { requestId?: string } }
      'assertion import-json': { args: {}; options: { requestId?: string; input: string } }
      'assertion payload-schema': { args: {}; options: {} }
      'assertion save': { args: {}; options: { requestId?: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; timeZone?: string; assertion: "absence_asserted" | "denial_asserted" | "negative_screening" | "normality_asserted" | "not_applicable" | "not_pregnant" | "no_known_conditions" | "no_known_allergies" | "no_known_drug_allergies" | "no_known_food_allergies" | "no_known_medications" | "no_known_family_history"; domain?: "allergy" | "condition" | "family" | "medication" | "pregnancy" | "screening" | "social" | "symptom" | "test" | "exam" | "other"; polarity?: "absent" | "denied" | "normal" | "negative" | "not_applicable"; subject?: string; assertionText?: string; assertedOn?: string; sourceLabel?: string } }
      'assertion scaffold': { args: {}; options: { requestId?: string } }
      'assistant ask': { args: { prompt: string }; options: { requestId?: string; session?: string; alias?: string; channel?: string; identity?: string; participant?: string; thread?: string; codexCommand?: string; codexHome?: string; model?: string; modelProvider?: string; reasoningEffort?: "low" | "medium" | "high" | "xhigh"; sandbox?: "read-only" | "workspace-write" | "danger-full-access"; approvalPolicy?: "never"; profile?: string; deliverResponse?: boolean; deliveryTarget?: string } }
      'assistant chat': { args: { prompt?: string }; options: { requestId?: string; session?: string; alias?: string; channel?: string; identity?: string; participant?: string; thread?: string; codexCommand?: string; codexHome?: string; model?: string; modelProvider?: string; reasoningEffort?: "low" | "medium" | "high" | "xhigh"; sandbox?: "read-only" | "workspace-write" | "danger-full-access"; approvalPolicy?: "never"; profile?: string } }
      'assistant deliver': { args: { message: string }; options: { requestId?: string; session?: string; alias?: string; channel?: string; identity?: string; participant?: string; thread?: string; deliveryTarget?: string } }
      'assistant doctor': { args: {}; options: { requestId?: string; repair: boolean } }
      'assistant onboarding complete': { args: {}; options: { requestId?: string; reason: "user_answered" | "user_declined" | "manual" } }
      'assistant onboarding reopen': { args: {}; options: { requestId?: string } }
      'assistant onboarding resume-context': { args: {}; options: { requestId?: string; limit: number } }
      'assistant onboarding status': { args: {}; options: { requestId?: string } }
      'assistant run': { args: {}; options: { requestId?: string; maxPerScan: number; allowSelfAuthored?: boolean; sessionRolloverHours?: number; once?: boolean } }
      'assistant self-target clear': { args: { channel?: string }; options: { requestId?: string } }
      'assistant self-target list': { args: {}; options: { requestId?: string } }
      'assistant self-target set': { args: { channel: string }; options: { requestId?: string; identity?: string; participant?: string; thread?: string; deliveryTarget?: string } }
      'assistant self-target show': { args: { channel: string }; options: { requestId?: string } }
      'assistant session list': { args: {}; options: { requestId?: string; limit: number } }
      'assistant session show': { args: { sessionId: string }; options: { requestId?: string } }
      'assistant status': { args: {}; options: { requestId?: string; session?: string; limit: number } }
      'assistant stop': { args: {}; options: { requestId?: string } }
      'audit list': { args: {}; options: { requestId?: string; action?: string; actor?: string; status?: string; from?: string; to?: string; sort: "asc" | "desc"; limit: number } }
      'audit show': { args: { id: string }; options: { requestId?: string } }
      'audit tail': { args: {}; options: { requestId?: string; limit: number } }
      'automation edit': { args: { lookup: string }; options: { requestId?: string; title?: string; activeUntil?: string; clearActiveUntil?: boolean; slug?: string; status?: "active" | "paused" | "archived"; summary?: string; tag?: string[]; tags?: string[]; supportSeriesId?: string; supportKind?: "reminder" | "check_in" | "review" | "weekly_digest"; continuityPolicy?: "fresh" | "preserve"; triggerKind?: "at" | "every" | "cron" | "dailyLocal" | "deviceActivity"; triggerAt?: string; triggerEveryMs?: number; triggerCron?: string; triggerLocalTime?: string; deviceSource?: "whoop" | "whoop_v2"; activityKind?: string; scheduleKind?: "at" | "every" | "cron" | "dailyLocal"; scheduleAt?: string; scheduleEveryMs?: number; scheduleCron?: string; scheduleLocalTime?: string; channel?: string; deliveryTarget?: string; identityId?: string; participantId?: string; threadId?: string; assistantTargetOverrideModel?: string; assistantTargetOverrideModelProvider?: string; assistantTargetOverrideReasoningEffort?: "low" | "medium" | "high" | "xhigh"; instructions?: string; clearSupportKind?: boolean; clearAssistantTargetOverride?: boolean } }
      'automation import-json': { args: {}; options: { requestId?: string; input: string } }
      'automation list': { args: {}; options: { requestId?: string; status?: ("active" | "paused" | "archived")[]; text?: string; supportSeriesId?: string; cursor?: string; limit: number } }
      'automation reconcile-support-series': { args: { seriesId: string }; options: { requestId?: string; desiredAutomationId?: string[] } }
      'automation save': { args: { title: string }; options: { requestId?: string; id?: string; activeUntil?: string; clearActiveUntil?: boolean; slug?: string; status?: "active" | "paused" | "archived"; summary?: string; tag?: string[]; tags?: string[]; supportSeriesId?: string; supportKind?: "reminder" | "check_in" | "review" | "weekly_digest"; continuityPolicy?: "fresh" | "preserve"; triggerKind?: "at" | "every" | "cron" | "dailyLocal" | "deviceActivity"; triggerAt?: string; triggerEveryMs?: number; triggerCron?: string; triggerLocalTime?: string; deviceSource?: "whoop" | "whoop_v2"; activityKind?: string; scheduleKind?: "at" | "every" | "cron" | "dailyLocal"; scheduleAt?: string; scheduleEveryMs?: number; scheduleCron?: string; scheduleLocalTime?: string; channel?: string; deliveryTarget?: string; identityId?: string; participantId?: string; threadId?: string; assistantTargetOverrideModel?: string; assistantTargetOverrideModelProvider?: string; assistantTargetOverrideReasoningEffort?: "low" | "medium" | "high" | "xhigh"; instructions: string } }
      'automation scaffold': { args: {}; options: { requestId?: string } }
      'automation set-status': { args: { lookup: string }; options: { requestId?: string; status: "active" | "paused" | "archived" } }
      'automation show': { args: { lookup: string }; options: { requestId?: string } }
      'batch': { args: {}; options: { requestId?: string; command: string[]; compact: boolean; stopOnError: boolean } }
      'blood-test import-json': { args: {}; options: { requestId?: string; input: string } }
      'blood-test list': { args: {}; options: { requestId?: string; status?: string; from?: string; to?: string; text?: string; limit: number } }
      'blood-test payload-schema': { args: {}; options: {} }
      'blood-test save': { args: { title: string }; options: { requestId?: string; id?: string; occurredAt?: string | string; recordedAt?: string; timeZone?: string; source?: "manual" | "import" | "device" | "derived"; note?: string; tag?: string[]; link?: string[]; rawRef?: string[]; testName: string; resultStatus?: "pending" | "normal" | "abnormal" | "mixed" | "unknown"; summary?: string; specimenType?: string; labName?: string; labPanelId?: string; collectedAt?: string; reportedAt?: string; fastingStatus?: "fasting" | "non_fasting" | "unknown"; result: string[] } }
      'blood-test scaffold': { args: {}; options: { requestId?: string } }
      'blood-test show': { args: { id: string }; options: { requestId?: string } }
      'capture add': { args: {}; options: { requestId?: string; media?: string[]; label?: string; bodySite?: string; collection?: string; tag?: string[]; relatedId?: string[]; note?: string; title?: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; timeZone?: string } }
      'capture import-json': { args: {}; options: { requestId?: string; input: string; media?: string[]; label?: string; bodySite?: string; collection?: string; tag?: string[]; relatedId?: string[]; note?: string; title?: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; timeZone?: string } }
      'capture list': { args: {}; options: { requestId?: string; from?: string; to?: string; tag?: string[]; limit: number; label?: string; bodySite?: string; collection?: string } }
      'capture manifest': { args: { id: string }; options: { requestId?: string } }
      'capture payload-schema': { args: {}; options: {} }
      'capture show': { args: { id: string }; options: { requestId?: string } }
      'chat': { args: { prompt?: string }; options: { requestId?: string; session?: string; alias?: string; channel?: string; identity?: string; participant?: string; thread?: string; codexCommand?: string; codexHome?: string; model?: string; modelProvider?: string; reasoningEffort?: "low" | "medium" | "high" | "xhigh"; sandbox?: "read-only" | "workspace-write" | "danger-full-access"; approvalPolicy?: "never"; profile?: string } }
      'clinical-note import-json': { args: {}; options: { requestId?: string; input: string } }
      'clinical-note payload-schema': { args: {}; options: {} }
      'clinical-note scaffold': { args: {}; options: { requestId?: string } }
      'commons knowledge search': { args: { query: string }; options: { focus?: string; limit: number } }
      'commons protocol explore': { args: { lookup: string }; options: { limit: number } }
      'commons protocol list': { args: {}; options: { query?: string; status?: string; category?: string[]; limit: number } }
      'commons protocol show': { args: { key: string }; options: {} }
      'condition import-json': { args: {}; options: { requestId?: string; input: string } }
      'condition list': { args: {}; options: { requestId?: string; status?: string; limit: number } }
      'condition payload-schema': { args: {}; options: {} }
      'condition save': { args: { title: string }; options: { requestId?: string; id?: string; slug?: string; clinicalStatus?: "active" | "inactive" | "resolved"; verificationStatus?: "unconfirmed" | "provisional" | "confirmed" | "refuted"; assertedOn?: string; resolvedOn?: string; severity?: "mild" | "moderate" | "severe"; bodySite?: string[]; relatedGoalId?: string[]; relatedRegimenId?: string[]; note?: string } }
      'condition scaffold': { args: {}; options: { requestId?: string } }
      'condition show': { args: { id: string }; options: { requestId?: string } }
      'device account disconnect': { args: { accountId: string }; options: { requestId?: string; baseUrl?: string } }
      'device account list': { args: {}; options: { requestId?: string; baseUrl?: string; provider?: string; "source-provider"?: string } }
      'device account reconcile': { args: { accountId: string }; options: { requestId?: string; baseUrl?: string } }
      'device account show': { args: { accountId: string }; options: { requestId?: string; baseUrl?: string } }
      'device connect': { args: { provider: string }; options: { requestId?: string; baseUrl?: string; returnTo?: string; open?: boolean } }
      'device daemon start': { args: {}; options: { requestId?: string; baseUrl?: string } }
      'device daemon status': { args: {}; options: { requestId?: string; baseUrl?: string } }
      'device daemon stop': { args: {}; options: { requestId?: string; baseUrl?: string } }
      'device provider list': { args: {}; options: { requestId?: string; baseUrl?: string } }
      'diagnostic-test import-json': { args: {}; options: { requestId?: string; input: string } }
      'diagnostic-test payload-schema': { args: {}; options: {} }
      'diagnostic-test save': { args: { testName: string }; options: { requestId?: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; timeZone?: string; resultStatus?: "pending" | "normal" | "abnormal" | "mixed" | "unknown"; summary?: string; testCategory?: string; specimenType?: string; labName?: string; reportedAt?: string } }
      'diagnostic-test scaffold': { args: {}; options: { requestId?: string } }
      'doctor': { args: {}; options: { requestId?: string; repair: boolean } }
      'document delete': { args: { id: string }; options: { requestId?: string } }
      'document edit': { args: { id: string }; options: { requestId?: string; title?: string; note?: string; occurredAt?: string | string; timeZone?: string; dayKey?: string; source?: "manual" | "import" | "device" | "derived"; tag?: string[]; clearTitle?: boolean; clearNote?: boolean; clearTimeZone?: boolean; clearDayKey?: boolean; clearSource?: boolean; clearTags?: boolean; dayKeyPolicy?: "keep" | "recompute" } }
      'document import': { args: { file: string }; options: { requestId?: string; title?: string; occurredAt?: string | string; note?: string; source?: "manual" | "import" | "device" | "derived" } }
      'document list': { args: {}; options: { requestId?: string; from?: string; to?: string; limit: number } }
      'document manifest': { args: { id: string }; options: { requestId?: string } }
      'document show': { args: { id: string }; options: { requestId?: string } }
      'encounter import-json': { args: {}; options: { requestId?: string; input: string } }
      'encounter payload-schema': { args: {}; options: {} }
      'encounter scaffold': { args: {}; options: { requestId?: string } }
      'event adverse-effect add': { args: {}; options: { requestId?: string; substance: string; effect: string; severity?: "mild" | "moderate" | "severe"; occurredAt: string | string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; tag?: string[] } }
      'event dedupe-device-imports': { args: {}; options: { requestId?: string; apply: boolean } }
      'event delete': { args: { id: string }; options: { requestId?: string } }
      'event edit': { args: { id: string }; options: { requestId?: string; title?: string; note?: string; occurredAt?: string | string; timeZone?: string; dayKey?: string; source?: "manual" | "import" | "device" | "derived"; tag?: string[]; clearTitle?: boolean; clearNote?: boolean; clearTimeZone?: boolean; clearDayKey?: boolean; clearSource?: boolean; clearTags?: boolean; dayKeyPolicy?: "keep" | "recompute" } }
      'event encounter add': { args: {}; options: { requestId?: string; encounterType: string; location?: string; providerId?: string; occurredAt: string | string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; tag?: string[] } }
      'event exposure add': { args: {}; options: { requestId?: string; exposureType: string; substance: string; duration?: string; occurredAt: string | string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; tag?: string[] } }
      'event import-json': { args: {}; options: { requestId?: string; input: string } }
      'event import-jsonl': { args: {}; options: { requestId?: string; input: string; apply: boolean } }
      'event list': { args: {}; options: { requestId?: string; kind?: string; from?: string; to?: string; tag?: string[]; experiment?: string; limit: number } }
      'event medication-intake add': { args: {}; options: { requestId?: string; medicationName: string; dose: number; unit: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; tag?: string[] } }
      'event note add': { args: {}; options: { requestId?: string; note: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; title?: string; tag?: string[] } }
      'event observation add': { args: {}; options: { requestId?: string; metric: string; value: number; unit: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; tag?: string[] } }
      'event payload-schema': { args: {}; options: { for: "import-jsonl"; kind: "symptom" | "note" | "observation" | "clinical_assertion" | "exposure" | "measurement" | "test" | "medication_intake" | "supplement_intake" | "activity_session" | "body_measurement" | "sleep_session" | "intervention_session" | "experiment_context" } }
      'event procedure add': { args: {}; options: { requestId?: string; procedure: string; status?: "ordered" | "planned" | "completed" | "cancelled"; occurredAt: string | string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; tag?: string[] } }
      'event scaffold': { args: {}; options: { requestId?: string; kind: "symptom" | "note" | "observation" | "measurement" | "medication_intake" | "supplement_intake" | "activity_session" | "body_measurement" | "sleep_session" | "intervention_session" | "experiment_context" } }
      'event show': { args: { id: string }; options: { requestId?: string } }
      'event supplement-intake add': { args: {}; options: { requestId?: string; supplementName: string; dose: number; unit: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; tag?: string[] } }
      'event symptom add': { args: {}; options: { requestId?: string; symptom: string; severity: number; bodyRegion?: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; tag?: string[] } }
      'exercise facets': { args: {}; options: {} }
      'exercise list': { args: {}; options: { query?: string; kind?: ("exercise" | "stretch" | "mobility" | "breathing")[]; environment?: ("at_home" | "gym")[]; category?: string[]; target?: string[]; level?: ("beginner" | "intermediate" | "advanced")[]; equipment?: string[]; position?: string[]; modality?: string[]; commonness?: ("very_common" | "common" | "variant")[]; limit: number } }
      'exercise show': { args: { lookup: string }; options: {} }
      'experiment checkpoint': { args: { lookup: string }; options: { requestId?: string; occurredAt?: string; title?: string; note?: string } }
      'experiment context log': { args: { lookup: string }; options: { requestId?: string; kind?: "experiment_context" | "note" | "supplement_intake"; occurredAt?: string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; contextType?: string; severity?: "info" | "potential_confounder" | "safety" | "blocking"; tag?: string[]; supplementName?: string; dose?: number; unit?: string } }
      'experiment edit': { args: { id: string }; options: { requestId?: string; title?: string; hypothesis?: string; startedOn?: string; status?: "planned" | "active" | "paused" | "completed" | "abandoned"; body?: string; tag?: string[]; protocolKey?: string; pageRevisionId?: string; runSpecRevisionId?: string; testPlanId?: string; baselineStart?: string; baselineEnd?: string; baselineDays?: number; interventionStart?: string; interventionEnd?: string; interventionDays?: number; modality?: string; scheduleKind?: "dailyLocal" | "cron"; scheduleCron?: string; scheduleLocalTime?: string; scheduleTimeZone?: string; dose?: string; sessionsPerWeek?: number; targetSessions?: number; minimumUsefulSessions?: number; sessionField?: string[]; confounderField?: string[]; stopCondition?: string[]; primaryBiomarkerKey?: string; primaryOutcomeKey?: string; primaryOutcomeKind?: "metric" | "structured_review"; primaryOutcomeLabel?: string; primaryOutcomeSessionField?: string; primaryOutcomeUnit?: string; primaryOutcomeSourceMetricKey?: string; comparisonStatistic?: "latest" | "count" | "mean" | "median" | "min" | "max" | "sum"; secondaryBiomarkerKey?: string[]; desiredDirection?: "increase" | "decrease" | "stabilize"; expectedDirection?: string[]; analysisAnchor?: string[]; plannedMeasurement?: string[]; analysisNote?: string[]; onboardingCompletedAt?: string; setupAnswer?: string[]; safetyCautionLevel?: "low" | "moderate" | "high" | "unknown"; safetyDisposition?: "continue_with_caution" | "clinician_guidance_before_unsupervised_start" | "do_not_start_unsupervised" | "do_not_start_unsupervised_explicit_clinician_clearance_required"; positiveQuestionId?: string[]; safetyNote?: string[]; contextNote?: string[]; reminderPolicy?: string; reminderOptionId?: string; remindersEnabled?: boolean; checkInCadence?: "none" | "daily" | "every_3_days" | "weekly"; notificationStyle?: "skip_by_default" | "send_scheduled_summary"; missedLogFollowup?: "never" | "opt_in_only" | "default_on"; weeklyDigestEnabled?: boolean; hydrateProtocolDefaults?: boolean } }
      'experiment followup due': { args: { id: string }; options: { requestId?: string; kind: "missed-log" | "weekly-digest"; date?: string } }
      'experiment list': { args: {}; options: { requestId?: string; limit: number; status?: "planned" | "active" | "paused" | "completed" | "abandoned" } }
      'experiment outcome analyze': { args: { id: string }; options: { requestId?: string; asOf?: string } }
      'experiment outcome write': { args: { id: string }; options: { requestId?: string; asOf?: string } }
      'experiment progress': { args: { id: string }; options: { requestId?: string; asOf?: string } }
      'experiment progress-card': { args: { id: string }; options: { requestId?: string; asOf?: string; confounder?: string[] } }
      'experiment session attach': { args: { lookup: string; eventId: string }; options: { requestId?: string; replace?: boolean; allowOutOfWindow?: boolean } }
      'experiment session detach': { args: { eventId: string }; options: { requestId?: string } }
      'experiment session log': { args: { lookup: string }; options: { requestId?: string; date?: string; occurredAt?: string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; interventionType?: string; status?: "completed" | "partial" | "missed" | "skipped"; sessionStatus?: "completed" | "partial" | "missed" | "skipped"; durationMinutes?: number; protocolId?: string; timing?: string; temperatureC?: number; afterExercise?: boolean; symptoms?: string[]; confounders?: string[]; confounder?: string[]; field?: string[] } }
      'experiment show': { args: { id: string }; options: { requestId?: string } }
      'experiment start': { args: { slug: string }; options: { requestId?: string; title?: string; hypothesis?: string; startedOn?: string; status?: "planned" | "active" | "paused" | "completed" | "abandoned"; body?: string; fromProtocol?: string; custom?: boolean; publicProtocol?: boolean; testPlanId?: string; pageRevisionId?: string; runSpecRevisionId?: string; baselineStart?: string; baselineEnd?: string; baselineDays?: number; interventionStart?: string; interventionEnd?: string; interventionDays?: number; modality?: string; scheduleKind?: "dailyLocal" | "cron"; scheduleCron?: string; scheduleLocalTime?: string; scheduleTimeZone?: string; dose?: string; sessionsPerWeek?: number; targetSessions?: number; minimumUsefulSessions?: number; sessionField?: string[]; confounderField?: string[]; stopCondition?: string[]; primaryBiomarkerKey?: string; primaryOutcomeKey?: string; primaryOutcomeKind?: "metric" | "structured_review"; primaryOutcomeLabel?: string; primaryOutcomeSessionField?: string; primaryOutcomeUnit?: string; primaryOutcomeSourceMetricKey?: string; comparisonStatistic?: "latest" | "count" | "mean" | "median" | "min" | "max" | "sum"; secondaryBiomarkerKey?: string[]; desiredDirection?: "increase" | "decrease" | "stabilize"; expectedDirection?: string[]; analysisAnchor?: string[]; plannedMeasurement?: string[]; analysisNote?: string[]; onboardingCompletedAt?: string; setupAnswer?: string[]; safetyCautionLevel?: "low" | "moderate" | "high" | "unknown"; safetyDisposition?: "continue_with_caution" | "clinician_guidance_before_unsupervised_start" | "do_not_start_unsupervised" | "do_not_start_unsupervised_explicit_clinician_clearance_required"; positiveQuestionId?: string[]; safetyNote?: string[]; contextNote?: string[]; reminderPolicy?: string; reminderOptionId?: string; remindersEnabled?: boolean; checkInCadence?: "none" | "daily" | "every_3_days" | "weekly"; notificationStyle?: "skip_by_default" | "send_scheduled_summary"; missedLogFollowup?: "never" | "opt_in_only" | "default_on"; weeklyDigestEnabled?: boolean; dryRun?: boolean } }
      'experiment stop': { args: { id: string }; options: { requestId?: string; occurredAt?: string; note?: string } }
      'export pack create': { args: {}; options: { requestId?: string; from: string; to: string; experiment?: string; out?: string } }
      'export pack list': { args: {}; options: { requestId?: string; from?: string; to?: string; experiment?: string; limit: number } }
      'export pack materialize': { args: { id: string }; options: { requestId?: string; out?: string } }
      'export pack prune': { args: { id: string }; options: { requestId?: string } }
      'export pack show': { args: { id: string }; options: { requestId?: string } }
      'family import-json': { args: {}; options: { requestId?: string; input: string } }
      'family list': { args: {}; options: { requestId?: string; limit: number } }
      'family save': { args: { title: string }; options: { requestId?: string; id?: string; slug?: string; relationship: string; condition?: string[]; deceased?: boolean; relatedVariantId?: string[]; note?: string } }
      'family scaffold': { args: {}; options: { requestId?: string } }
      'family show': { args: { id: string }; options: { requestId?: string } }
      'food delete': { args: { id: string }; options: { requestId?: string } }
      'food edit': { args: { id: string }; options: { requestId?: string; title?: string; slug?: string; status?: "active" | "archived"; summary?: string; kind?: string; brand?: string; vendor?: string; location?: string; serving?: string; calories?: number; proteinGrams?: number; carbsGrams?: number; fatGrams?: number; fiberGrams?: number; nutritionSource?: "user" | "label" | "database" | "inherited" | "estimated"; nutritionConfidence?: "low" | "medium" | "high"; nutritionSourceDetail?: string; alias?: string[]; ingredient?: string[]; tag?: string[]; note?: string; attachedRegimenId?: string[]; linkRelatedRegimenId?: string[]; clearSummary?: boolean; clearKind?: boolean; clearBrand?: boolean; clearVendor?: boolean; clearLocation?: boolean; clearServing?: boolean; clearNutrition?: boolean; clearAliases?: boolean; clearIngredients?: boolean; clearTags?: boolean; clearNote?: boolean; clearAttachedRegimenIds?: boolean; clearLinks?: boolean } }
      'food import-json': { args: {}; options: { requestId?: string; input: string } }
      'food list': { args: {}; options: { requestId?: string; status?: "active" | "archived"; limit: number } }
      'food rename': { args: { lookup: string }; options: { requestId?: string; title: string; slug?: string } }
      'food save': { args: { title: string }; options: { requestId?: string; id?: string; slug?: string; status?: "active" | "archived"; summary?: string; kind?: string; brand?: string; vendor?: string; location?: string; serving?: string; calories?: number; proteinGrams?: number; carbsGrams?: number; fatGrams?: number; fiberGrams?: number; nutritionSource?: "user" | "label" | "database" | "inherited" | "estimated"; nutritionConfidence?: "low" | "medium" | "high"; nutritionSourceDetail?: string; alias?: string[]; ingredient?: string[]; tag?: string[]; note?: string; attachedRegimenId?: string[]; linkRelatedRegimenId?: string[] } }
      'food scaffold': { args: {}; options: { requestId?: string } }
      'food schedule': { args: { title: string }; options: { requestId?: string; time: string; note?: string; slug?: string } }
      'food search-labels': { args: { query: string }; options: { limit?: number; fullLabel?: boolean; generic?: boolean; includeOffMarket?: boolean } }
      'food search-labels-batch': { args: {}; options: { query: string[]; limit?: number; fullLabel?: boolean; generic?: boolean; includeOffMarket?: boolean } }
      'food show': { args: { id: string }; options: { requestId?: string } }
      'food unschedule': { args: { id: string }; options: { requestId?: string } }
      'genetics import-json': { args: {}; options: { requestId?: string; input: string } }
      'genetics list': { args: {}; options: { requestId?: string; status?: string; limit: number } }
      'genetics save': { args: { title: string }; options: { requestId?: string; id?: string; slug?: string; gene: string; zygosity?: "heterozygous" | "homozygous" | "compound_heterozygous" | "unknown"; significance?: "pathogenic" | "likely_pathogenic" | "risk_factor" | "vus" | "benign" | "unknown"; inheritance?: string; sourceFamilyMemberId?: string[]; note?: string } }
      'genetics scaffold': { args: {}; options: { requestId?: string } }
      'genetics show': { args: { id: string }; options: { requestId?: string } }
      'goal import-json': { args: {}; options: { requestId?: string; input: string } }
      'goal list': { args: {}; options: { requestId?: string; status?: string; limit: number } }
      'goal save': { args: { title: string }; options: { requestId?: string; id?: string; slug?: string; status?: "active" | "paused" | "completed" | "abandoned"; horizon?: "short_term" | "medium_term" | "long_term" | "ongoing"; priority?: number; startAt?: string; targetAt?: string; parentGoalId?: string; relatedGoalId?: string[]; relatedExperimentId?: string[]; domain?: string[] } }
      'goal scaffold': { args: {}; options: { requestId?: string } }
      'goal show': { args: { id: string }; options: { requestId?: string } }
      'habitat catalog': { args: { aspect?: string }; options: {} }
      'habitat coverage': { args: {}; options: { domain?: "environment" | "workspace" | "exercise" } }
      'habitat list': { args: {}; options: { domain?: "environment" | "workspace" | "exercise" } }
      'habitat save': { args: { aspect: string }; options: { indicator?: string[]; recordedAt?: string; note?: string; body?: string } }
      'habitat show': { args: { lookup: string }; options: {} }
      'immunization import-json': { args: {}; options: { requestId?: string; input: string } }
      'immunization list': { args: {}; options: { requestId?: string; from?: string; to?: string; limit: number } }
      'immunization save': { args: { vaccineName: string }; options: { requestId?: string; occurredAt?: string | string; recordedAt?: string; timeZone?: string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; tag?: string[]; rawRef?: string[]; manufacturer?: string; lotNumber?: string; route?: string; site?: string; series?: string; targetDisease?: string[] } }
      'immunization scaffold': { args: {}; options: { requestId?: string } }
      'immunization show': { args: { id: string }; options: { requestId?: string } }
      'init': { args: {}; options: { requestId?: string; timezone?: string } }
      'intake import': { args: { file: string }; options: { requestId?: string; title?: string; occurredAt?: string | string; importedAt?: string; source?: "import" | "manual" | "derived" } }
      'intake list': { args: {}; options: { requestId?: string; from?: string; to?: string; limit: number } }
      'intake manifest': { args: { id: string }; options: { requestId?: string } }
      'intake project': { args: { id: string }; options: { requestId?: string } }
      'intake show': { args: { id: string }; options: { requestId?: string } }
      'intervention add': { args: { text: string }; options: { requestId?: string; duration?: number; type?: string; regimenId?: string; experiment?: string; skipExperimentLink?: boolean; allowOutOfWindow?: boolean; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived" } }
      'intervention delete': { args: { id: string }; options: { requestId?: string } }
      'intervention edit': { args: { id: string }; options: { requestId?: string; title?: string; note?: string; occurredAt?: string | string; timeZone?: string; dayKey?: string; source?: "manual" | "import" | "device" | "derived"; tag?: string[]; clearTitle?: boolean; clearNote?: boolean; clearTimeZone?: boolean; clearDayKey?: boolean; clearSource?: boolean; clearTags?: boolean; dayKeyPolicy?: "keep" | "recompute"; type?: string; duration?: number; regimenId?: string; sessionStatus?: "completed" | "partial" | "missed" | "skipped"; clearDuration?: boolean; clearRegimenId?: boolean } }
      'journal append': { args: { date: string }; options: { requestId?: string; text: string } }
      'journal ensure': { args: { date: string }; options: { requestId?: string } }
      'journal link': { args: { date: string }; options: { requestId?: string; eventId?: string[]; stream?: string[] } }
      'journal list': { args: {}; options: { requestId?: string; from?: string; to?: string; limit: number } }
      'journal show': { args: { date: string }; options: { requestId?: string } }
      'journal unlink': { args: { date: string }; options: { requestId?: string; eventId?: string[]; stream?: string[] } }
      'knowledge append-section': { args: { slug: string; heading: string }; options: { requestId?: string; body: string; title?: string; position: "prepend" | "append"; sourcePath?: string[] } }
      'knowledge index rebuild': { args: {}; options: { requestId?: string } }
      'knowledge lint': { args: {}; options: { requestId?: string } }
      'knowledge list': { args: {}; options: { requestId?: string; pageType?: string; status?: string; limit: number } }
      'knowledge log tail': { args: {}; options: { requestId?: string; limit: number } }
      'knowledge score-challenge': { args: {}; options: { input: string } }
      'knowledge search': { args: { query: string }; options: { requestId?: string; pageType?: string; status?: string; limit: number } }
      'knowledge show': { args: { slug: string }; options: { requestId?: string } }
      'knowledge upsert': { args: {}; options: { requestId?: string; body: string; title?: string; slug?: string; pageType?: string; status?: string; clearLibraryLinks?: boolean; relatedSlug?: string[]; librarySlug?: string[]; sourcePath?: string[] } }
      'list': { args: {}; options: { requestId?: string; recordType?: string[]; kind?: string; status?: string; stream?: string[]; experiment?: string; from?: string; to?: string; tag?: string[]; limit: number } }
      'meal add': { args: {}; options: { requestId?: string; photo?: string; audio?: string; note?: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; ingredient?: string[]; nutritionCalories?: number; nutritionProteinGrams?: number; nutritionCarbsGrams?: number; nutritionFatGrams?: number; nutritionFiberGrams?: number; nutritionSource?: "user" | "label" | "database" | "inherited" | "estimated"; nutritionConfidence?: "low" | "medium" | "high"; nutritionSourceDetail?: string } }
      'meal closeout-work': { args: {}; options: { requestId?: string; limit: number; occurrenceAt: string; to?: string } }
      'meal delete': { args: { id: string }; options: { requestId?: string } }
      'meal edit': { args: { id: string }; options: { requestId?: string; title?: string; note?: string; occurredAt?: string | string; timeZone?: string; dayKey?: string; source?: "manual" | "import" | "device" | "derived"; tag?: string[]; clearTitle?: boolean; clearNote?: boolean; clearTimeZone?: boolean; clearDayKey?: boolean; clearSource?: boolean; clearTags?: boolean; dayKeyPolicy?: "keep" | "recompute"; ingredient?: string[]; nutritionCalories?: number; nutritionProteinGrams?: number; nutritionCarbsGrams?: number; nutritionFatGrams?: number; nutritionFiberGrams?: number; nutritionSource?: "user" | "label" | "database" | "inherited" | "estimated"; nutritionConfidence?: "low" | "medium" | "high"; nutritionSourceDetail?: string; clearIngredients?: boolean; clearNutrition?: boolean } }
      'meal import-json': { args: {}; options: { requestId?: string; input: string; photo?: string; audio?: string; note?: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; ingredient?: string[]; nutritionCalories?: number; nutritionProteinGrams?: number; nutritionCarbsGrams?: number; nutritionFatGrams?: number; nutritionFiberGrams?: number; nutritionSource?: "user" | "label" | "database" | "inherited" | "estimated"; nutritionConfidence?: "low" | "medium" | "high"; nutritionSourceDetail?: string } }
      'meal list': { args: {}; options: { requestId?: string; from?: string; to?: string; limit: number } }
      'meal manifest': { args: { id: string }; options: { requestId?: string } }
      'meal remove-photo': { args: { id: string }; options: { requestId?: string } }
      'meal show': { args: { id: string }; options: { requestId?: string } }
      'meal totals': { args: {}; options: { requestId?: string; from?: string; to?: string } }
      'measurement add': { args: {}; options: { requestId?: string; metric?: string[]; value?: number[]; unit?: string[]; qualifier?: string[]; measurementNote?: string[]; note?: string; title?: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; media?: string[]; tag?: string[]; timeZone?: string } }
      'measurement import-json': { args: {}; options: { requestId?: string; input: string; note?: string; title?: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; media?: string[] } }
      'measurement list': { args: {}; options: { requestId?: string; from?: string; to?: string; limit: number } }
      'measurement manifest': { args: { id: string }; options: { requestId?: string } }
      'measurement show': { args: { id: string }; options: { requestId?: string } }
      'medication history add': { args: { title: string }; options: { requestId?: string; id?: string; slug?: string; stoppedOn?: string; schedule?: string; substance?: string; dose?: number; unit?: string; group?: string; note?: string; relatedGoalId?: string[]; relatedConditionId?: string[]; relatedRegimenId?: string[]; startedOn: string } }
      'memory forget': { args: { memoryId: string }; options: {} }
      'memory set-name': { args: { displayName: string }; options: {} }
      'memory show': { args: { memoryId?: string }; options: {} }
      'memory update': { args: { memoryId: string; text: string }; options: { section?: "Identity" | "Preferences" | "Instructions" | "Context" } }
      'memory upsert': { args: { text: string }; options: { section: "Identity" | "Preferences" | "Instructions" | "Context" } }
      'model': { args: {}; options: { show?: boolean; preset?: "codex"; model?: string; modelProvider?: string; codexCommand?: string; profile?: string; codexHome?: string; reasoningEffort?: "low" | "medium" | "high" | "xhigh"; oss?: boolean } }
      'protocol import-json': { args: {}; options: { requestId?: string; input: string } }
      'protocol list': { args: {}; options: { requestId?: string; status?: string; commonsProtocol?: string; limit: number } }
      'protocol show': { args: { id: string }; options: { requestId?: string } }
      'provider delete': { args: { id: string }; options: { requestId?: string } }
      'provider edit': { args: { id: string }; options: { requestId?: string; title?: string; slug?: string; status?: string; specialty?: string; organization?: string; location?: string; website?: string; phone?: string; note?: string; alias?: string[]; body?: string; clearSpecialty?: boolean; clearOrganization?: boolean; clearLocation?: boolean; clearWebsite?: boolean; clearPhone?: boolean; clearNote?: boolean; clearAliases?: boolean; clearBody?: boolean } }
      'provider import-json': { args: {}; options: { requestId?: string; input: string } }
      'provider list': { args: {}; options: { requestId?: string; status?: string; limit: number } }
      'provider save': { args: { title: string }; options: { requestId?: string; id?: string; slug?: string; status?: string; specialty?: string; organization?: string; location?: string; website?: string; phone?: string; note?: string; alias?: string[]; body?: string } }
      'provider scaffold': { args: {}; options: { requestId?: string } }
      'provider show': { args: { id: string }; options: { requestId?: string } }
      'query projection rebuild': { args: {}; options: { requestId?: string } }
      'query projection status': { args: {}; options: { requestId?: string } }
      'recipe delete': { args: { id: string }; options: { requestId?: string } }
      'recipe edit': { args: { id: string }; options: { requestId?: string; title?: string; slug?: string; status?: "draft" | "saved" | "archived"; summary?: string; cuisine?: string; dishType?: string; source?: string; servings?: number; prepTimeMinutes?: number; cookTimeMinutes?: number; totalTimeMinutes?: number; tag?: string[]; ingredient?: string[]; step?: string[]; relatedGoalId?: string[]; relatedConditionId?: string[]; link?: string[]; clearSummary?: boolean; clearCuisine?: boolean; clearDishType?: boolean; clearSource?: boolean; clearServings?: boolean; clearPrepTime?: boolean; clearCookTime?: boolean; clearTotalTime?: boolean; clearTags?: boolean; clearIngredients?: boolean; clearSteps?: boolean; clearRelatedGoalIds?: boolean; clearRelatedConditionIds?: boolean; clearLinks?: boolean } }
      'recipe import-json': { args: {}; options: { requestId?: string; input: string } }
      'recipe list': { args: {}; options: { requestId?: string; status?: "draft" | "saved" | "archived"; limit: number } }
      'recipe save': { args: { title: string }; options: { requestId?: string; id?: string; slug?: string; status?: "draft" | "saved" | "archived"; summary?: string; cuisine?: string; dishType?: string; source?: string; servings?: number; prepTimeMinutes?: number; cookTimeMinutes?: number; totalTimeMinutes?: number; tag?: string[]; ingredient?: string[]; step?: string[]; relatedGoalId?: string[]; relatedConditionId?: string[]; link?: string[] } }
      'recipe scaffold': { args: {}; options: { requestId?: string } }
      'recipe show': { args: { id: string }; options: { requestId?: string } }
      'regimen import-json': { args: {}; options: { requestId?: string; input: string } }
      'regimen list': { args: {}; options: { requestId?: string; status?: string; limit: number } }
      'regimen save': { args: { title: string }; options: { requestId?: string; id?: string; slug?: string; kind: "medication" | "supplement" | "therapy" | "habit"; status?: "active" | "paused" | "completed" | "stopped"; startedOn?: string; stoppedOn?: string; schedule?: string; brand?: string; manufacturer?: string; servingSize?: string; note?: string; substance?: string; dose?: number; unit?: string; ingredientCompound?: string; ingredientLabel?: string; ingredientAmount?: number; ingredientUnit?: string; ingredientNote?: string; ingredientActive?: boolean; group?: string; relatedGoalId?: string[]; relatedConditionId?: string[]; relatedRegimenId?: string[] } }
      'regimen scaffold': { args: {}; options: { requestId?: string } }
      'regimen show': { args: { id: string }; options: { requestId?: string } }
      'regimen stop': { args: { regimenId: string }; options: { requestId?: string; stoppedOn?: string } }
      'research payload-schema': { args: {}; options: {} }
      'research scout': { args: {}; options: { input: string; since: string; until: string; maxCandidates: number } }
      'research scout-batch': { args: {}; options: { input: string; since: string; until: string; maxCandidatesPerLane: number } }
      'research scout-batch-payload-schema': { args: {}; options: {} }
      'route estimate': { args: { origin: string; destination: string }; options: { waypoint?: string[]; profile?: "walking" | "cycling" | "driving" | "driving-traffic"; elevation?: boolean; geometry?: boolean; country?: string[]; language?: string; elevationSampleSpacingMeters?: number; maxElevationSamples?: number } }
      'route resolve-address': { args: { query: string }; options: { country?: string[]; language?: string } }
      'run': { args: {}; options: { requestId?: string; maxPerScan: number; allowSelfAuthored?: boolean; sessionRolloverHours?: number; once?: boolean } }
      'samples add': { args: {}; options: { requestId?: string; stream: "heart_rate" | "spo2" | "hrv" | "steps" | "sleep_stage" | "respiratory_rate" | "temperature" | "glucose"; unit: string; recordedAt: string; value?: number; source?: "device" | "import" | "manual" | "derived"; quality?: "raw" | "normalized" | "derived"; sourcePath?: string; batchSourceFileName?: string; batchPresetId?: string; batchDelimiter?: string; batchTimestampColumn?: string; batchValueColumn?: string; batchMetadataColumns?: string[]; stage?: "awake" | "light" | "deep" | "rem"; startAt?: string; endAt?: string; durationMinutes?: number } }
      'samples batch list': { args: {}; options: { requestId?: string; stream?: string; from?: string; to?: string; limit: number } }
      'samples batch show': { args: { id: string }; options: { requestId?: string } }
      'samples csv import': { args: { file: string }; options: { requestId?: string; preset?: string; stream?: string; tsColumn?: string; valueColumn?: string; unit?: string; delimiter?: string; metadataColumns?: string[]; source?: string } }
      'samples csv profile': { args: { file: string }; options: { requestId?: string; preset?: string; stream?: string; tsColumn?: string; valueColumn?: string; unit?: string; delimiter?: string; metadataColumns?: string[]; source?: string; includeSummary?: boolean; summaryProfile?: "oxygen-night"; thresholdBelow?: number[]; gapSeconds?: number } }
      'samples import-csv': { args: { file: string }; options: { requestId?: string; preset?: string; stream?: string; tsColumn?: string; valueColumn?: string; unit?: string; delimiter?: string; metadataColumns?: string[]; source?: string } }
      'samples import-json': { args: {}; options: { requestId?: string; input: string } }
      'samples list': { args: {}; options: { requestId?: string; stream?: string; from?: string; to?: string; quality?: string; limit: number } }
      'samples show': { args: { id: string }; options: { requestId?: string } }
      'samples summarize': { args: {}; options: { requestId?: string; stream: string; from?: string; to?: string; profile?: "oxygen-night"; thresholdBelow?: number[]; gapSeconds?: number } }
      'scheduled-log archive': { args: { lookup: string }; options: { requestId?: string } }
      'scheduled-log import-json': { args: {}; options: { requestId?: string; input: string } }
      'scheduled-log list': { args: {}; options: { requestId?: string; status?: ("active" | "paused" | "archived")[]; text?: string; limit: number } }
      'scheduled-log pause': { args: { lookup: string }; options: { requestId?: string } }
      'scheduled-log resume': { args: { lookup: string }; options: { requestId?: string } }
      'scheduled-log save': { args: { title: string }; options: { requestId?: string; id?: string; slug?: string; status?: "active" | "paused" | "archived"; scheduleKind: "at" | "every" | "cron" | "dailyLocal"; scheduleAt?: string; scheduleEveryMs?: number; scheduleCron?: string; scheduleLocalTime?: string; actionKind: "meal.add" | "activity_session.add" | "intervention_session.add" | "measurement.add"; actionTitle?: string; actionNote?: string; actionTag?: string[]; foodId?: string; ingredient?: string[]; nutritionCalories?: number; nutritionProteinGrams?: number; nutritionCarbsGrams?: number; nutritionFatGrams?: number; nutritionFiberGrams?: number; nutritionSource?: "user" | "label" | "database" | "inherited" | "estimated"; nutritionConfidence?: "low" | "medium" | "high"; nutritionSourceDetail?: string; activityType?: string; interventionType?: string; durationMinutes?: number; distanceKm?: number; protocolId?: string; workoutSourceApp?: string; workoutSourceWorkoutId?: string; workoutStartedAt?: string; workoutEndedAt?: string; workoutRoutineId?: string; workoutRoutineName?: string; workoutSessionNote?: string; workoutMedia?: string[]; workoutExercise?: string[]; workoutSet?: string[]; measurementMetric?: string[]; measurementValue?: number[]; measurementUnit?: string[]; measurementQualifier?: string[]; measurementNote?: string[]; summary?: string; tag?: string[]; body?: string } }
      'scheduled-log scaffold': { args: {}; options: { requestId?: string } }
      'scheduled-log show': { args: { lookup: string }; options: { requestId?: string } }
      'search query': { args: { query?: string }; options: { requestId?: string; text?: string; recordType?: string[]; kind?: string[]; stream?: string[]; experiment?: string; from?: string; to?: string; tag?: string[]; limit: number } }
      'show': { args: { id: string }; options: { requestId?: string } }
      'social-history import-json': { args: {}; options: { requestId?: string; input: string } }
      'social-history payload-schema': { args: {}; options: {} }
      'social-history scaffold': { args: {}; options: { requestId?: string } }
      'status': { args: {}; options: { requestId?: string; session?: string; limit: number } }
      'stop': { args: {}; options: { requestId?: string } }
      'supplement compound list': { args: {}; options: { requestId?: string; limit: number; status?: string } }
      'supplement compound show': { args: { compound: string }; options: { requestId?: string; status?: string } }
      'supplement list': { args: {}; options: { requestId?: string; limit: number; status?: string } }
      'supplement save': { args: { title: string }; options: { requestId?: string; id?: string; slug?: string; status?: "active" | "paused" | "completed" | "stopped"; startedOn?: string; stoppedOn?: string; schedule?: string; group?: string; substance?: string; dose?: number; doseUnit?: string; brand?: string; manufacturer?: string; servingSize?: string; ingredient?: string[]; relatedGoalId?: string[]; relatedConditionId?: string[]; relatedRegimenId?: string[] } }
      'supplement search-labels': { args: { query: string }; options: { limit?: number; includeOffMarket?: boolean } }
      'supplement search-labels-batch': { args: {}; options: { query: string[]; limit?: number; includeOffMarket?: boolean } }
      'supplement show': { args: { id: string }; options: { requestId?: string } }
      'supplement stop': { args: { id: string }; options: { requestId?: string; stoppedOn?: string } }
      'timeline': { args: {}; options: { requestId?: string; from?: string; to?: string; experiment?: string; kind?: string[]; stream?: string[]; entryType?: string[]; limit: number } }
      'validate': { args: {}; options: { requestId?: string } }
      'vault compact-inbox-parser-attempts': { args: {}; options: { requestId?: string; dryRun: boolean; apply: boolean; maxAttempts?: number } }
      'vault repair': { args: {}; options: { requestId?: string } }
      'vault repair-experiment-media': { args: {}; options: { requestId?: string; dryRun: boolean; apply: boolean } }
      'vault repair-inbox-envelopes': { args: {}; options: { requestId?: string; dryRun: boolean; apply: boolean; maxFiles?: number } }
      'vault repair-integration-ingests': { args: {}; options: { requestId?: string; dryRun: boolean; apply: boolean; finalize: boolean; maxBundles?: number; maxBytes?: number } }
      'vault repair-junction-hr-zones': { args: {}; options: { requestId?: string; dryRun: boolean; apply: boolean } }
      'vault repair-wearable-storage': { args: {}; options: { requestId?: string; dryRun: boolean; apply: boolean; pruneDenseRaw: boolean; includeRecentDenseRaw: boolean; maxFiles?: number; maxBytes?: number } }
      'vault show': { args: {}; options: { requestId?: string } }
      'vault stats': { args: {}; options: { requestId?: string } }
      'vault update': { args: {}; options: { requestId?: string; title?: string; timezone?: string } }
      'vitals import-json': { args: {}; options: { requestId?: string; input: string } }
      'vitals payload-schema': { args: {}; options: {} }
      'vitals save': { args: {}; options: { requestId?: string; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; title?: string; note?: string; timeZone?: string; systolic?: number; diastolic?: number; heartRate?: number; respiratoryRate?: number; temperatureF?: number; temperatureC?: number; spo2?: number; weightLb?: number; heightIn?: number } }
      'vitals scaffold': { args: {}; options: { requestId?: string } }
      'wearables activity list': { args: {}; options: { requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; limit: number } }
      'wearables body list': { args: {}; options: { requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; limit: number } }
      'wearables day': { args: { date: string }; options: { requestId?: string; provider?: string[] } }
      'wearables drift': { args: {}; options: { requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; windowDays: number } }
      'wearables latest': { args: {}; options: { requestId?: string; date?: string; from?: string; to?: string; provider?: string[] } }
      'wearables metric latest': { args: { metric: string }; options: { requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; windowDays: number } }
      'wearables metric trend': { args: { metric: string }; options: { requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; windowDays: number } }
      'wearables recovery list': { args: {}; options: { requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; limit: number } }
      'wearables sleep list': { args: {}; options: { requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; limit: number } }
      'wearables sleep pattern': { args: {}; options: { requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; timeZone?: string; windowDays: number } }
      'wearables sources list': { args: {}; options: { requestId?: string; date?: string; from?: string; to?: string; provider?: string[]; limit: number } }
      'workout active': { args: {}; options: { requestId?: string; workoutId?: string } }
      'workout add': { args: { text?: string }; options: { requestId?: string; note?: string; title?: string; duration?: number; type?: string; distanceKm?: number; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; media?: string[]; workoutSourceApp?: string; workoutSourceWorkoutId?: string; workoutStartedAt?: string; workoutEndedAt?: string; workoutRoutineId?: string; workoutRoutineName?: string; workoutSessionNote?: string; workoutMedia?: string[]; workoutExercise?: string[]; workoutSet?: string[] } }
      'workout delete': { args: { id: string }; options: { requestId?: string } }
      'workout edit': { args: { id: string }; options: { requestId?: string; title?: string; note?: string; occurredAt?: string | string; timeZone?: string; dayKey?: string; source?: "manual" | "import" | "device" | "derived"; tag?: string[]; clearTitle?: boolean; clearNote?: boolean; clearTimeZone?: boolean; clearDayKey?: boolean; clearSource?: boolean; clearTags?: boolean; dayKeyPolicy?: "keep" | "recompute"; duration?: number; type?: string; distanceKm?: number; workoutSourceApp?: string; workoutSourceWorkoutId?: string; workoutStartedAt?: string; workoutEndedAt?: string; workoutRoutineId?: string; workoutRoutineName?: string; workoutSessionNote?: string; workoutMedia?: string[]; workoutExercise?: string[]; workoutSet?: string[]; clearDuration?: boolean; clearDistance?: boolean; clearWorkout?: boolean } }
      'workout exercise add': { args: { name: string }; options: { requestId?: string; workoutId?: string; sourceExerciseId?: string; order: number; groupId?: string; mode?: "weight_reps" | "bodyweight" | "assisted_bodyweight" | "weighted_bodyweight" | "duration" | "cardio"; unitOverride?: "lb" | "kg"; note?: string; sets: number } }
      'workout finish': { args: {}; options: { requestId?: string; workoutId?: string; endedAt?: string } }
      'workout format import-json': { args: { name?: string; text?: string }; options: { requestId?: string; input: string } }
      'workout format list': { args: {}; options: { requestId?: string; limit: number } }
      'workout format log': { args: { name: string }; options: { requestId?: string; duration?: number; type?: string; distanceKm?: number; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; media?: string[] } }
      'workout format save': { args: { name?: string; text?: string }; options: { requestId?: string; workoutFormatId?: string; slug?: string; status?: "active" | "archived"; summary?: string; tag?: string[]; note?: string; templateText?: string; routineNote?: string; exercise?: string[]; setTemplate?: string[]; duration?: number; type?: string; distanceKm?: number } }
      'workout format show': { args: { name: string }; options: { requestId?: string } }
      'workout import csv': { args: { file: string }; options: { requestId?: string; source?: string; delimiter?: string; storeRawOnly?: boolean } }
      'workout import inspect': { args: { file: string }; options: { requestId?: string; source?: string; delimiter?: string } }
      'workout import-json': { args: { text?: string }; options: { requestId?: string; input: string; note?: string; title?: string; duration?: number; type?: string; distanceKm?: number; occurredAt?: string | string; source?: "manual" | "import" | "device" | "derived"; media?: string[] } }
      'workout list': { args: {}; options: { requestId?: string; from?: string; to?: string; limit: number } }
      'workout manifest': { args: { id: string }; options: { requestId?: string } }
      'workout payload-schema': { args: {}; options: {} }
      'workout set clear': { args: { exercise?: string }; options: { requestId?: string; workoutId?: string; exerciseId?: string; exerciseOrder?: number; setOrder: number } }
      'workout set log': { args: { exercise?: string }; options: { requestId?: string; workoutId?: string; exerciseId?: string; exerciseOrder?: number; setOrder: number; type?: "normal" | "warmup" | "dropset" | "failure"; note?: string; reps?: number; weight?: number; weightUnit?: "lb" | "kg"; durationSeconds?: number; distanceMeters?: number; rpe?: number; bodyweightKg?: number; assistanceKg?: number; addedWeightKg?: number } }
      'workout show': { args: { id: string }; options: { requestId?: string } }
      'workout start': { args: { name?: string }; options: { requestId?: string; routine?: string; type?: string; note?: string; startedAt?: string } }
      'workout units set': { args: {}; options: { requestId?: string; weight?: "lb" | "kg"; bodyMeasurement?: "cm" | "in"; recordedAt?: string } }
      'workout units show': { args: {}; options: { requestId?: string } }
    }
  }
}
