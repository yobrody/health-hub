/// Rest-timer duration — a pure, tested function mirroring the legacy
/// `gym-decision.ts` shape (base-by-intensity × effort modifier, rounded to the
/// nearest 5s, floored at 20s).
///
/// HONESTY / product-default note: the base durations are a documented product
/// default keyed on how the exercise is loaded (compounds rest longest) — NOT
/// fabricated per-user data. The only signal we honestly have between sets is
/// the equipment type and the (optional) effort the user just rated, so those
/// are the only two inputs. No sleep/load/gym-location modifiers — those need
/// data we don't have (YAGNI until a program layer supplies it).
library;

import 'dart:math' as math;

import 'exercise.dart';
import 'workout_session.dart';

/// Honest base rest in seconds by equipment. Compounds (free weights) tax the
/// nervous system most → rest longest; cardio needs almost none.
int _baseRestSeconds(EquipmentType equipment) {
  switch (equipment) {
    case EquipmentType.freeWeight:
      return 120;
    case EquipmentType.machine:
      return 90;
    case EquipmentType.bodyweight:
      return 60;
    case EquipmentType.cardio:
      return 30;
  }
}

/// Effort modifier applied to the base rest. A near-failure set (angry) needs
/// MORE rest; an easy set needs LESS; a grind (contempt) or an unrated set is
/// neutral. `null` (not yet rated) is neutral — never assume a middle effort.
double _effortModifier(SetEffort? lastEffort) {
  switch (lastEffort) {
    case SetEffort.angry:
      return 1.15; // near failure → more rest
    case SetEffort.easy:
      return 0.85; // easy → less rest
    case SetEffort.contempt:
      return 1.0; // grind → neutral
    case null:
      return 1.0; // unrated → neutral
  }
}

/// The tailored rest duration in seconds for the set just completed.
///
/// `raw = base(equipment) × modifier(lastEffort)`, then rounded to the nearest
/// 5s and floored at 20s: `max(20, (raw/5).round()*5)`.
int restSecondsFor(EquipmentType equipment, SetEffort? lastEffort) {
  final raw = _baseRestSeconds(equipment) * _effortModifier(lastEffort);
  final roundedToFive = (raw / 5).round() * 5;
  return math.max(20, roundedToFive);
}
