# Replacing an untouched draft workout

Read this when the member asks to replace a workout that was started and never
used, for example "scrap that one and start it again with these exercises".
The order below matters: the new workout is created and checked before the old
one is deleted, so a failure never loses data. Commands are in
`tracked-table/SKILL.md`.

## When a workout can be replaced

Read the workout with `vault-cli workout show <evt_id> --format json`. It can
be replaced only when all of these hold:

- It was started with the member's own exercise list and has no saved format.
- It has no `endedAt`.
- Every set is still empty.
- It has nothing else worth keeping: no set notes, metrics, heart-rate zones,
  route, media, attachments or provider workout id.

If any of these is uncertain, keep the workout and correct it with the ordinary
set and exercise commands. A request about yesterday, an older date, a finished
workout or an older card is always a correction of that workout and never a
replacement.

## Get a clear yes

Replace only when the member tells you to, or says yes to your proposal right
away. The proposal names the draft that will be deleted, says its start time,
activity type and note will carry over unless they ask otherwise, and repeats
the new title, every exercise in order, each set count, and any exact
repetition count they gave for every set. Keep the draft's id and its
`lifecycle.revision` from the read.

## Replace it

1. **Create the new workout.** Run one `vault-cli workout start "<name>"` with
   the draft's exact `--started-at`, `--type` and, when it has one, `--note`,
   plus one `--exercise` per requested exercise. Change those carried-over
   fields only when the member approved the change. The command must hold the
   complete exercise list.
2. **Check the result.** It should return a new `eventId` with the complete
   workout in order. If the command was rejected before writing, the old
   workout is unchanged and you can stop. If the result is missing, interrupted
   or unclear, treat the approval as used: keep the old workout, do not delete
   it, and do not run `workout start` again for this approval.
3. **After an unclear result, look for the new workout before anything else.**
   Run
   `vault-cli workout list --from <draft start date> --to <draft start date> --limit 200 --format json`,
   leave out the old id, and read every other candidate with `workout show`. A
   candidate is the new workout only when its `recordedAt` falls between the
   approval and now and its title, type, note, start time, exercises in order,
   set counts and repetition counts all equal what was approved. With exactly
   one match, continue. With none, several, an incomplete list or a failed
   read, keep every record, tell the member what is uncertain and which
   workouts are involved, and ask them to choose.
4. **Delete the old draft** only after step 2 or step 3 confirmed the new
   workout:
   `vault-cli workout delete <old_evt_id> --expected-revision <revision from the read>`.
5. **If the delete fails or reports a conflict,** keep both workouts. Do not
   delete the new one. Tell the member what happened, read both again, and get
   a new yes before any later delete.

Other unfinished workouts are not part of this and stay as they are.
