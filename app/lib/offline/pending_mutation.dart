/// A single mutation that is waiting to be sent to the server.
///
/// Mirrors the legacy `OutboxItem` from `src/lib/outbox.ts` with one addition:
/// [dedupeKey] (a logical bucket, e.g. `"food/today"`) lets us replace a
/// stale enqueue with a fresh one rather than stacking duplicates.
class PendingMutation {
  const PendingMutation({
    required this.id,
    required this.dedupeKey,
    required this.method,
    required this.path,
    this.body,
    required this.createdAt,
    this.tries = 0,
  });

  /// Unique identifier for this specific enqueue instance (opaque string).
  final String id;

  /// Logical deduplication bucket (e.g. `"food/today"`, `"water/today"`).
  /// Two mutations with the same [dedupeKey] represent the same logical
  /// operation; the newer one supersedes the older one in the queue.
  final String dedupeKey;

  /// HTTP method, e.g. `"POST"`, `"PUT"`, `"DELETE"`.
  final String method;

  /// API path, e.g. `"/food"`.
  final String path;

  /// Request body as a plain Dart map (will be JSON-encoded when sent).
  /// May be null for DELETE or body-less requests.
  final Map<String, dynamic>? body;

  /// Unix epoch milliseconds when this mutation was first enqueued.
  final int createdAt;

  /// How many times this mutation has been attempted and rejected by the server.
  /// (Network failures do NOT increment this — the item simply stays queued.)
  /// Parity with legacy `MAX_TRIES = 8`: once [tries] reaches [kMaxTries] the
  /// mutation is considered permanently broken and should be dropped via
  /// [dropExpired].
  final int tries;

  // ── Serialisation ──────────────────────────────────────────────────────────

  Map<String, dynamic> toJson() => {
        'id': id,
        'dedupeKey': dedupeKey,
        'method': method,
        'path': path,
        if (body != null) 'body': body,
        'createdAt': createdAt,
        'tries': tries,
      };

  factory PendingMutation.fromJson(Map<String, dynamic> json) =>
      PendingMutation(
        id: json['id'] as String,
        dedupeKey: json['dedupeKey'] as String,
        method: json['method'] as String,
        path: json['path'] as String,
        body: json['body'] != null
            ? Map<String, dynamic>.from(json['body'] as Map)
            : null,
        createdAt: json['createdAt'] as int,
        tries: json['tries'] as int? ?? 0,
      );
}
