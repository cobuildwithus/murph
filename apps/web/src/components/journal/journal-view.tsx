import type { JournalEvent, JournalView } from "@murphai/query/browser-overview";

export function JournalViewContent({ journal }: { journal: JournalView }) {
  return (
    <main className="space-y-8">
      <header>
        <p>Private health timeline</p>
        <h1 className="text-3xl font-semibold">Journal</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Notes, workouts, sleep, measurements, and test results appear here as one timeline.
          To add, correct, or remove something, tell Murph.
        </p>
      </header>

      {journal.days.length === 0 ? (
        <section>
          <h2>No Journal events yet</h2>
          <p>Tell Murph what happened, how you felt, or what context may matter.</p>
        </section>
      ) : (
        <div className="space-y-10">
          {journal.days.map((day) => (
            <section key={day.date} aria-labelledby={`journal-day-${day.date}`}>
              <h2 id={`journal-day-${day.date}`} className="text-xl font-semibold">
                {formatDay(day.date)}
              </h2>
              <ol className="mt-4 space-y-5">
                {day.events.map((event) => (
                  <li key={event.id}>
                    <JournalEventView event={event} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function JournalEventView({ event }: { event: JournalEvent }) {
  return (
    <article aria-label={event.title}>
      <div>
        <time dateTime={event.occurredAt}>{formatTime(event.occurredAt, event.timeZone)}</time>
        <h3 className="font-medium">{event.title}</h3>
      </div>
      <ul className="mt-2 space-y-2">
        {event.records.map((record) => (
          <li key={record.id}>
            <span>{record.label}</span>
            {record.summary ? <span>: {record.summary}</span> : null}
            {record.source ? (
              <small className="ml-2 text-muted-foreground">{record.source}</small>
            ) : null}
          </li>
        ))}
      </ul>
    </article>
  );
}

function formatDay(date: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "full",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function formatTime(value: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(value));
}
