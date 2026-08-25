"use client";

import { CheckCircle2Icon, RefreshCwIcon, SendIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/src/components/ui/alert";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Textarea } from "@/src/components/ui/textarea";
import type {
  HostedOperatorTaskKind,
  HostedOperatorTaskView,
} from "@/src/lib/hosted-ops/operator-task";

export function OperatorTasksClient({
  initialTasks,
}: {
  initialTasks: HostedOperatorTaskView[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [kind, setKind] = useState<HostedOperatorTaskKind>("diagnostic");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await requestJson<{ tasks: HostedOperatorTaskView[] }>(
        "/api/ops/operator-tasks",
      );
      setTasks(response.tasks);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setPending(false);
    }
  }

  async function submit(formData: FormData): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const task = await requestJson<HostedOperatorTaskView>(
        "/api/ops/operator-tasks",
        {
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            kind,
            memberId: String(formData.get("memberId") ?? ""),
            prompt: String(formData.get("prompt") ?? ""),
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      setTasks((current) => [task, ...current].slice(0, 20));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border/70 pb-6">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
          Ops notebook
        </span>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight md:text-4xl">
          Murph tasks
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Ask one member&apos;s Murph for a private read-only diagnostic, or have Murph send one direct message through the normal conversation.
        </p>
      </header>

      <section className="rounded-xl border border-border/70 bg-card/90 p-5">
        <div className="flex gap-2" role="group" aria-label="Task kind">
          <Button
            onClick={() => setKind("diagnostic")}
            type="button"
            variant={kind === "diagnostic" ? "default" : "outline"}
          >
            Private diagnostic
          </Button>
          <Button
            onClick={() => setKind("member_message")}
            type="button"
            variant={kind === "member_message" ? "default" : "outline"}
          >
            Member message
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {kind === "diagnostic"
            ? "The result returns here only. Nothing is sent to the member."
            : "Murph writes one message using the current private conversation and normal delivery safeguards."}
        </p>
        <form
          className="mt-5 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(new FormData(event.currentTarget));
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="operator-task-member-id">Member ID or phone last four</Label>
            <Input
              autoComplete="off"
              id="operator-task-member-id"
              name="memberId"
              placeholder="hbm_... or 3537"
              required
              spellCheck={false}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="operator-task-prompt">
              {kind === "diagnostic" ? "What should Murph inspect?" : "What should Murph communicate?"}
            </Label>
            <Textarea
              id="operator-task-prompt"
              maxLength={1200}
              name="prompt"
              required
              rows={6}
            />
          </div>
          <div>
            <Button disabled={pending} type="submit">
              <SendIcon data-icon="inline-start" />
              {pending ? "Submitting..." : "Submit task"}
            </Button>
          </div>
        </form>
        {error ? (
          <Alert className="mt-4" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </section>

      <section aria-labelledby="operator-task-history" className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl font-semibold" id="operator-task-history">
            Recent tasks
          </h2>
          <Button disabled={pending} onClick={() => void refresh()} size="sm" type="button" variant="outline">
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        </div>
        {tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            No tasks submitted yet.
          </p>
        ) : tasks.map((task) => (
          <article className="rounded-xl border border-border/70 bg-card/90 p-5" key={task.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {task.kind === "diagnostic" ? "Diagnostic" : "Message"}
              </Badge>
              <Badge variant="outline">
                {task.status === "completed" ? <CheckCircle2Icon data-icon="inline-start" /> : null}
                {task.status}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">{task.memberId}</span>
            </div>
            {task.result ? (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6">
                {task.result.answer ?? "Murph could not answer this diagnostic."}
              </p>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground">
              {new Date(task.createdAt).toLocaleString()}
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json() as { error?: { message?: string } } & T;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Request failed.");
  }
  return payload;
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Request failed.";
}
