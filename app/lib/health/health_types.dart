/// Health-data types for the Flutter Health Hub.
///
/// P0 imports only **steps** and **sleep**. The rest of the health picture
/// (active energy, resting HR, HRV, body weight, body-fat %, workouts) is
/// scaffolded below as clearly-marked TODOs so the later tasks have a home,
/// but is intentionally NOT implemented yet.
///
/// ## The honesty rule (critical — do not soften)
/// Absent health data is [null], **never** `0`. "No steps recorded today" and
/// "0 steps recorded today" are different truths; conflating them corrupts
/// TDEE / readiness downstream. Every function here that can find no data
/// returns `null` — the summing helpers seed from the samples themselves, so
/// there is no way to accidentally emit a `0` for absent data.
library;

/// The health metrics this app can read.
///
/// Only [steps] and [sleep] are wired up in P0. The commented entries are the
/// deferred set — uncomment + wire the real reads (and the platform
/// permissions) when their task lands.
enum HealthMetric {
  steps,
  sleep,
  // TODO(p1): activeEnergy — Apple `activeEnergyBurned` / HC `ACTIVE_ENERGY_BURNED`.
  // TODO(p1): restingHeartRate — Apple `restingHeartRate` / HC `RESTING_HEART_RATE`.
  // TODO(p1): heartRateVariability — Apple HRV SDNN / HC `HEART_RATE_VARIABILITY_RMSSD`.
  // TODO(p1): bodyWeight — Apple `bodyMass` / HC `WEIGHT`.
  // TODO(p1): bodyFatPercentage — Apple `bodyFatPercentage` / HC `BODY_FAT`.
  // TODO(p1): workouts — Apple `HKWorkout` / HC `EXERCISE`.
}

/// A single normalized health reading.
///
/// This is the plugin-independent value type the pure logic operates on. The
/// real [HealthDataSource] converts the `health` package's `HealthDataPoint`s
/// into these; tests construct them directly, so the summing / null-handling /
/// bucketing logic never needs the plugin (which cannot run under
/// `flutter test`).
///
/// [value] meaning by metric:
///  * [HealthMetric.steps]  — the step count for the sample.
///  * [HealthMetric.sleep]  — the sample's duration in **minutes** (asleep
///                            intervals report their length; the service sums
///                            these into hours).
class HealthSample {
  const HealthSample({
    required this.metric,
    required this.value,
    required this.start,
    required this.end,
  });

  final HealthMetric metric;
  final double value;
  final DateTime start;
  final DateTime end;

  Duration get duration => end.difference(start);
}
