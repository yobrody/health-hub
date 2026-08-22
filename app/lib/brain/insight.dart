/// The Brain's output model — a single, honest, personalized [Insight].
///
/// The Brain is the app's central nervous system: it turns each user's REAL
/// data (goals, today's food log, pantry, weigh-ins, workouts) into contextual
/// guidance, woven into every screen as connected cards with a visible "why".
///
/// **Honesty is the entire point.** Every field here — the title, the detail,
/// and above all every [WhyFact] value — comes from the user's real data. There
/// is no fabricated number, no guessed default, nothing that implies data we
/// don't have. When the data to ground an insight is missing, the engine emits a
/// [InsightKind.setup] insight (an honest "set this up" prompt), never filler.
///
/// This file, like the design system, is a leaf: it holds only plain data and
/// carries no repo/UI dependency, so the pure engine ([computeInsights]) and its
/// tests can build [Insight]s directly.
library;

/// What kind of guidance an insight carries. The screen-weaving layer filters by
/// kind (Food → buy, Nutrition → eat, Gym → train, Home → the top few of any).
///
///  • [eat] — what to eat now, grounded in the real remaining calorie/protein
///    goal vs today's real eaten totals (preferring real pantry items).
///  • [buy] — a real pantry item that's low / expiring / reorder-due.
///  • [train] — a workout is due, with the honest progression suggestion.
///  • [setup] — an honest prompt to provide missing data (no goal / no history);
///    NEVER a fabricated number. This is what the Brain shows instead of filler.
enum InsightKind { eat, buy, train, setup }

/// One real, traceable fact behind an insight — the `↳ why` line's content.
///
/// Both the [label] and [value] are REAL: the value is a user-provided or
/// user-derived number/string, never a guessed constant. A fact whose value we
/// can't ground honestly is simply not created (the engine omits it), so an
/// [Insight]'s [Insight.why] list only ever contains true statements.
class WhyFact {
  const WhyFact({required this.label, required this.value});

  /// The short label, e.g. "Calorie goal", "Eaten today", "In stock".
  final String label;

  /// The real value as display text, e.g. "2200 kcal", "1450 kcal", "2 left".
  /// Always sourced from real data — never a fabricated stand-in.
  final String value;

  @override
  bool operator ==(Object other) =>
      other is WhyFact && other.label == label && other.value == value;

  @override
  int get hashCode => Object.hash(label, value);

  @override
  String toString() => 'WhyFact($label: $value)';
}

/// What an insight's action button does. The card routes each to the right
/// screen, making the flow between screens explicit (the visible interconnection
/// the user asked to see).
///
///  • [addToCart] — add the named item to the real grocery list, then jump to
///    Cart.
///  • [startWorkout] — jump to the Gym page to start a session.
///  • [logMeal] — jump to the Nutrition (log food) flow.
///  • [openGoals] — open the daily-goals editor (used by the EAT setup prompt).
///  • [none] — an informational insight with no action.
enum InsightActionKind { addToCart, startWorkout, logMeal, openGoals, none }

/// The action attached to an insight — a label plus an optional [payload] the
/// handler needs (e.g. the pantry item name to add to the grocery list).
class InsightAction {
  const InsightAction({
    required this.kind,
    required this.label,
    this.payload,
  });

  /// A no-op action — used where an insight is informational only.
  static const InsightAction noneAction =
      InsightAction(kind: InsightActionKind.none, label: '');

  final InsightActionKind kind;

  /// The button label, e.g. "Add to list", "Start workout", "Log a meal".
  final String label;

  /// Optional data the handler needs. For [InsightActionKind.addToCart] this is
  /// the real item name to add to the grocery list. `null` when unused.
  final String? payload;

  @override
  bool operator ==(Object other) =>
      other is InsightAction &&
      other.kind == kind &&
      other.label == label &&
      other.payload == payload;

  @override
  int get hashCode => Object.hash(kind, label, payload);
}

/// One personalized, honest piece of guidance from the Brain.
///
/// Every non-[InsightKind.setup] insight MUST carry at least one real [WhyFact]:
/// if the engine can't ground an insight in real data, it does not emit it (a
/// smaller honest brain beats a fabricated one). A [InsightKind.setup] insight
/// intentionally carries no `why` facts — it's the honest prompt shown when the
/// data to compute a real insight is missing.
class Insight {
  const Insight({
    required this.id,
    required this.kind,
    required this.title,
    required this.detail,
    this.why = const [],
    this.action,
    this.priority = 0,
  });

  /// A stable id, unique within one [computeInsights] result. Drives the card's
  /// `Key('insight-card-<id>')` (and the action / why-toggle keys).
  final String id;

  final InsightKind kind;

  /// The one-line headline, e.g. "550 kcal left today".
  final String title;

  /// A short supporting sentence, e.g. "You have chicken + Greek yogurt —
  /// both high in protein."
  final String detail;

  /// The real, traceable facts behind this insight (the `↳ why` line). Empty
  /// only for a [InsightKind.setup] prompt.
  final List<WhyFact> why;

  /// The optional action (add-to-cart / start-workout / …). `null` when the
  /// insight is purely informational.
  final InsightAction? action;

  /// Relevance rank — HIGHER shows first. The engine orders most-actionable
  /// insights before setup prompts.
  final int priority;
}
