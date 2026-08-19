/// A simple quiet-hours window: notifications are suppressed when the current
/// hour is within `[startHour, endHour)`.
///
/// Handles wrap-around midnight (e.g. 22→7 means 22:00–06:59 is quiet).
/// All arithmetic is on 24-hour integers — no DateTime, no I/O — so the whole
/// thing is trivially unit-testable.
class QuietHours {
  const QuietHours({required this.startHour, required this.endHour})
      : assert(startHour >= 0 && startHour <= 23),
        assert(endHour >= 0 && endHour <= 23);

  /// The hour (0–23) at which quiet time begins (inclusive).
  final int startHour;

  /// The hour (0–23) at which quiet time ends (exclusive).
  final int endHour;
}

/// Returns `true` if [hour] (0–23) falls inside the quiet window defined by
/// [qh].
///
/// When `startHour <= endHour` the range is simple (non-wrapping):
///   `startHour <= hour < endHour`
///
/// When `startHour > endHour` the range wraps midnight, so the test is:
///   `hour >= startHour  OR  hour < endHour`
///
/// Edge: if `startHour == endHour` nothing is ever quiet (a zero-length window).
bool isWithinQuietHours(int hour, QuietHours qh) {
  assert(hour >= 0 && hour <= 23);
  if (qh.startHour == qh.endHour) return false; // zero-length window

  if (qh.startHour < qh.endHour) {
    // Non-wrapping: e.g. 0→6 means hours 0,1,2,3,4,5.
    return hour >= qh.startHour && hour < qh.endHour;
  } else {
    // Wrapping: e.g. 22→7 means hours 22,23,0,1,2,3,4,5,6.
    return hour >= qh.startHour || hour < qh.endHour;
  }
}
