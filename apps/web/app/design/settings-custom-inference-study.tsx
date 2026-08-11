"use client";

import { HostedAssistantModelSettings } from "@/src/components/settings/hosted-assistant-model-settings";
import { HostedInferenceConnectionPane } from "@/src/components/settings/hosted-inference-connection-settings";
import { Separator } from "@/src/components/ui/separator";
import { DESIGN_INFERENCE_CONNECTION } from "./design-inference-connection";

export function SettingsCustomInferenceStudy() {
  return (
    <div
      id="settings-custom-inference"
      className="mx-auto flex w-full max-w-5xl flex-col gap-8"
      data-design-section="settings-custom-inference"
      inert
    >
      <div
        className="flex flex-col gap-8"
        data-design-variant="managed-venice-disabled"
      >
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Managed route · verified endpoint inactive
        </p>
        <section className="flex flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            AI model
          </div>
          <HostedAssistantModelSettings
            canUpgradeToEdge={false}
            chatCompletionsAvailable
            configurationAvailable
            customInferenceAvailable
            initialConnection={{
              ...DESIGN_INFERENCE_CONNECTION,
              selected: false,
            }}
            initialDormantSolPreference={false}
            initialModel="gpt-5.6-terra"
            initialProvider="openai"
            solAvailable
            veniceAvailable={false}
          />
        </section>
      </div>

      <Separator />

      <div
        className="flex flex-col gap-8"
        data-design-variant="venice-terra-sol-locked"
      >
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Venice route · Terra selected · Sol locked
        </p>
        <section className="flex flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            AI model
          </div>
          <HostedAssistantModelSettings
            canUpgradeToEdge
            configurationAvailable
            customInferenceAvailable
            initialDormantSolPreference={false}
            initialModel="gpt-5.6-terra"
            initialProvider="venice"
            solAvailable={false}
            veniceAvailable
          />
        </section>
      </div>

      <Separator />

      <div
        className="flex flex-col gap-8"
        data-design-variant="custom-venice-enabled"
      >
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Endpoint route · Venice available
        </p>
        <section className="flex flex-col gap-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            AI model
          </div>
          <HostedAssistantModelSettings
            canUpgradeToEdge={false}
            chatCompletionsAvailable
            configurationAvailable
            customInferenceAvailable
            initialConnection={{
              ...DESIGN_INFERENCE_CONNECTION,
              selected: true,
            }}
            initialDormantSolPreference={false}
            initialModel="gpt-5.6-terra"
            initialProvider="venice"
            solAvailable
            veniceAvailable
          />
        </section>
      </div>

      <Separator />

      <div
        className="flex flex-col gap-8"
        data-design-variant="endpoint-pane"
      >
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Endpoint pane · setup form
        </p>
        <HostedInferenceConnectionPane
          chatCompletionsAvailable
          configurationAvailable
          connection={null}
          onConnectionChange={() => {}}
          selected={false}
        />
      </div>

      <Separator />

      <div
        className="flex flex-col gap-8"
        data-design-variant="endpoint-pane-verified"
      >
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Endpoint pane · verified connection
        </p>
        <HostedInferenceConnectionPane
          chatCompletionsAvailable
          configurationAvailable
          connection={DESIGN_INFERENCE_CONNECTION}
          onConnectionChange={() => {}}
          selected
        />
      </div>
    </div>
  );
}
