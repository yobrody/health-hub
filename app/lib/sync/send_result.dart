/// The classified outcome of attempting to send ONE queued mutation.
///
/// This is the richer result the Outbox needs to decide *retry vs reject* — a
/// distinction [ProbeStatus] alone cannot make (it collapses "the server
/// refused this bad write" and "we're simply offline" into the same
/// non-`online` value). A [MutationSender] classifies each attempt into one of
/// these so the Outbox can act honestly:
///
///  * [sent] — the server confirmed the write (2xx / a successful upsert).
///    The Outbox REMOVES the mutation from the queue.
///
///  * [retryEnvironment] — the failure is *environmental*, not the mutation's
///    fault: the device is offline, the request timed out with no response, OR
///    there is no authenticated session yet (a queued write can't be scoped to
///    a user until sign-in). The Outbox KEEPS the whole queue intact, does NOT
///    bump [PendingMutation.tries] (it isn't a bad mutation), and STOPS the
///    flush (we're offline / signed out — later items would fail identically).
///    This preserves the app's original "stop on offline" behaviour.
///
///  * [retryTransient] — the server (or its transport) failed on THIS mutation
///    in a way that a retry might fix: a 5xx, or a timeout *after* a connection
///    was established. The Outbox BUMPS [PendingMutation.tries]; if that reaches
///    `kMaxTries` the mutation is moved to the FAILED state (so a chronically
///    failing write never wedges the queue), otherwise it stays queued and the
///    flush CONTINUES to the next item.
///
///  * [rejectPermanent] — the server refused the write and a retry cannot help:
///    a validation error, a malformed body, a unique-constraint violation, or a
///    genuine RLS/permission denial for an authenticated user (4xx like
///    400/403/409/422; PostgREST codes like `42501`, `23505`, `22P02`). The
///    Outbox moves the mutation to the FAILED state IMMEDIATELY — never
///    silently dropped, and never left to block every good mutation behind it in
///    the FIFO queue (the head-of-line-block bug).
///
/// Honesty contract: nothing here ever fabricates a "sent". A mutation is only
/// removed on [sent]; every other outcome keeps it durable (queued or surfaced
/// as failed) so a user's write is never silently lost.
enum SendResult {
  sent,
  retryEnvironment,
  retryTransient,
  rejectPermanent,
}
