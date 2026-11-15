"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/src/components/ui/button";
import { Spinner } from "@/src/components/ui/spinner";

export function MemberSuspensionAction(props: {
  disabled: boolean;
  memberId: string;
  suspended: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const suspended = saved ?? props.suspended;
  const label = suspended ? "Restore" : "Suspend";

  async function save() {
    if (saving || props.disabled) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/ops/member-suspension", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId: props.memberId, operation: suspended ? "restore" : "suspend" }),
      });
      if (!response.ok) throw new Error("Could not save. Try again.");
      const result: unknown = await response.json();
      if (!result || typeof result !== "object"
        || Reflect.get(result, "suspended") !== !suspended) {
        throw new Error("Could not confirm the change. Try again.");
      }
      setSaved(!suspended);
      setConfirming(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-64 flex-col gap-2 whitespace-normal text-left">
      {confirming ? (
        <p className="text-xs text-muted-foreground">
          {suspended ? "Murph can reply again. They are not told." : "Murph stops replying to them. They are not told."}
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
      <div className="flex gap-2">
        {confirming ? (
          <Button disabled={saving} onClick={() => { setConfirming(false); setError(null); }} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
        ) : null}
        <Button
          aria-label={`${confirming ? "Confirm " : ""}${label} for ${props.memberId}`}
          disabled={props.disabled || saving}
          onClick={() => { if (confirming) void save(); else setConfirming(true); }}
          size="sm"
          type="button"
          variant={confirming && !suspended ? "destructive" : "outline"}
        >
          {saving ? <Spinner data-icon="inline-start" /> : null}
          {saving ? "Saving" : label}
        </Button>
      </div>
    </div>
  );
}
