// Pure-logic tests for the Transformation roadmap + physique milestones —
// parity with the legacy `src/lib/transformation.test.ts`, plus the Flutter
// additions (observed trend derived from real weigh-ins over ≥14 days, ETA to
// MONTH precision, needs-data when no current/target).
//
// Honesty invariants under test:
//  • A reliable observed trend (≥2 real readings ≥14 days apart, toward goal)
//    projects the ETA; an unreliable/away trend falls back to a DISCLOSED
//    default rate (usedDefaultRate == true).
//  • No current OR target weight → null (needs-data), never a fabricated date.
//  • ETA is month precision (YYYY-MM), never a to-the-day date.
//  • Abs is body-fat-anchored: needs-data without a real BF reading, real with;
//    the bulk-raises-BF caveat is always present.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/transformation/transformation.dart';

List<RoadmapWeighIn> _weighIns(List<(String, double)> entries) => entries
    .map((e) => RoadmapWeighIn(at: DateTime.parse(e.$1), weightKg: e.$2))
    .toList();

void main() {
  group('projectRoadmap', () {
    test('projects weeks + month ETA from a reliable observed trend toward goal',
        () {
      // 62 → 72kg. Two real readings 35 days apart: 62 → 63kg = +1kg over 5
      // weeks = +0.2 kg/wk. remaining 10kg / 0.2 = 50 weeks.
      final r = projectRoadmap(
        currentWeightKg: 63,
        targetWeightKg: 72,
        weighIns: _weighIns([
          ('2026-01-01T00:00:00Z', 62),
          ('2026-02-05T00:00:00Z', 63), // 35 days later
        ]),
        now: DateTime.parse('2026-02-05T00:00:00Z'),
      );
      expect(r, isNotNull);
      expect(r!.direction, RoadmapDirection.gain);
      expect(r.remainingKg, closeTo(9, 1e-6));
      expect(r.rateSource, RateSource.observed);
      expect(r.usedDefaultRate, isFalse);
      expect(r.onTrack, isTrue);
      expect(r.rateKgPerWeek, closeTo(0.2, 1e-6));
      expect(r.weeksToGoal, 45); // ceil(9 / 0.2)
      // ETA is month precision.
      expect(r.etaMonthIso, matches(RegExp(r'^\d{4}-\d{2}$')));
    });

    test('falls back to a DISCLOSED default rate when the trend is not reliable',
        () {
      // Only one real reading, or a <14-day span → not reliable → default rate.
      final r = projectRoadmap(
        currentWeightKg: 62,
        targetWeightKg: 72,
        weighIns: _weighIns([('2026-01-01T00:00:00Z', 62)]),
        now: DateTime.parse('2026-01-01T00:00:00Z'),
      );
      expect(r, isNotNull);
      expect(r!.rateSource, RateSource.defaultRate);
      expect(r.usedDefaultRate, isTrue);
      expect(r.rateKgPerWeek, greaterThan(0));
      expect(r.weeksToGoal, greaterThan(0));
      expect(r.note.toLowerCase(), contains('healthy'));
    });

    test('a reliable trend spanning <14 days is still NOT reliable', () {
      final r = projectRoadmap(
        currentWeightKg: 63,
        targetWeightKg: 72,
        weighIns: _weighIns([
          ('2026-01-01T00:00:00Z', 62),
          ('2026-01-08T00:00:00Z', 63), // only 7 days
        ]),
        now: DateTime.parse('2026-01-08T00:00:00Z'),
      );
      expect(r!.rateSource, RateSource.defaultRate);
      expect(r.usedDefaultRate, isTrue);
    });

    test('flags being off-track when a reliable trend moves AWAY from the goal',
        () {
      // Goal is to gain, but the real trend is losing → not on track. Still an
      // honest projection using the healthy default rate.
      final r = projectRoadmap(
        currentWeightKg: 62,
        targetWeightKg: 72,
        weighIns: _weighIns([
          ('2026-01-01T00:00:00Z', 64),
          ('2026-02-05T00:00:00Z', 62), // losing over 35 days
        ]),
        now: DateTime.parse('2026-02-05T00:00:00Z'),
      );
      expect(r!.onTrack, isFalse);
      expect(r.rateSource, RateSource.defaultRate);
      expect(r.note.toLowerCase(), contains('losing'));
    });

    test('returns no timeline when already at goal (maintain)', () {
      final r = projectRoadmap(
        currentWeightKg: 72,
        targetWeightKg: 72,
        weighIns: const [],
        now: DateTime.parse('2026-01-01T00:00:00Z'),
      );
      expect(r!.direction, RoadmapDirection.maintain);
      expect(r.weeksToGoal, isNull);
      expect(r.etaMonthIso, isNull);
    });

    test('returns null (needs-data) when there is no current weight', () {
      final r = projectRoadmap(
        currentWeightKg: null,
        targetWeightKg: 72,
        weighIns: const [],
        now: DateTime.parse('2026-01-01T00:00:00Z'),
      );
      expect(r, isNull);
    });

    test('returns null (needs-data) when there is no target weight', () {
      final r = projectRoadmap(
        currentWeightKg: 62,
        targetWeightKg: null,
        weighIns: const [],
        now: DateTime.parse('2026-01-01T00:00:00Z'),
      );
      expect(r, isNull);
    });

    test('ETA month is computed from now + weeks, month precision only', () {
      // Default gain rate ~0.17 kg/wk over 10kg → many weeks out.
      final r = projectRoadmap(
        currentWeightKg: 62,
        targetWeightKg: 72,
        weighIns: const [],
        now: DateTime.parse('2026-01-01T00:00:00Z'),
      );
      // Never a to-the-day date — exactly YYYY-MM.
      expect(r!.etaMonthIso, matches(RegExp(r'^\d{4}-\d{2}$')));
    });
  });

  group('physiqueMilestones', () {
    test('measures weight-anchored milestones from the START of the journey',
        () {
      final ms = physiqueMilestones(startKg: 62, currentKg: 65, goalKg: 72);
      final shoulders = ms.firstWhere((m) => m.id == 'shoulders');
      expect(shoulders.anchor, MilestoneAnchor.weight);
      expect(shoulders.targetWeightKg, 65); // 62 + 3kg
      expect(shoulders.status, MilestoneStatus.reached);
      expect(shoulders.progressPct, 1);
    });

    test('reports partial progress toward a not-yet-reached weight milestone',
        () {
      final ms = physiqueMilestones(startKg: 62, currentKg: 64, goalKg: 72);
      final chest = ms.firstWhere((m) => m.id == 'chest-back'); // 62+7=69kg
      expect(chest.targetWeightKg, 69);
      expect(chest.status, MilestoneStatus.approaching);
      expect(chest.progressPct, closeTo((64 - 62) / (69 - 62), 0.01));
    });

    test('anchors visible abs to BODY FAT, never to scale weight', () {
      final ms = physiqueMilestones(startKg: 62, currentKg: 66, goalKg: 72);
      final abs = ms.firstWhere((m) => m.id == 'abs');
      expect(abs.anchor, MilestoneAnchor.bodyFat);
      expect(abs.targetWeightKg, isNull);
    });

    test('does not fake abs progress without a body-fat reading', () {
      final abs = physiqueMilestones(startKg: 62, currentKg: 66, goalKg: 72)
          .firstWhere((m) => m.id == 'abs');
      expect(abs.status, MilestoneStatus.needsData);
      expect(abs.progressPct, isNull);
    });

    test('is honest that a bulk RAISES body fat when abs are the goal', () {
      final abs = physiqueMilestones(
        startKg: 62,
        currentKg: 66,
        goalKg: 72,
        bodyFatPct: 16,
      ).firstWhere((m) => m.id == 'abs');
      expect(abs.progressPct, isNotNull);
      expect(abs.note.toLowerCase(), matches(RegExp(r'bulk|cut|body.?fat')));
    });

    test('exposes the abs body-fat target so the UI never hardcodes it', () {
      final abs = physiqueMilestones(startKg: 62, currentKg: 66, goalKg: 72)
          .firstWhere((m) => m.id == 'abs');
      expect(abs.targetBodyFatPct, 12);
    });

    test('flags weight milestones that land BEYOND the current goal', () {
      // Goal is only +6kg (62→68) but the "chest & back" milestone needs +7kg
      // (69kg) — it can never be reached within the plan, so flag it honestly.
      final ms = physiqueMilestones(startKg: 62, currentKg: 64, goalKg: 68);
      final chest = ms.firstWhere((m) => m.id == 'chest-back'); // 69 > 68
      expect(chest.beyondGoal, isTrue);
      final shoulders = ms.firstWhere((m) => m.id == 'shoulders'); // 65 <= 68
      expect(shoulders.beyondGoal, isFalse);
    });
  });
}
