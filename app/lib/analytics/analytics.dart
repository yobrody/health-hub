// Analytics seam — the only file that knows about PostHog.
//
// Rules:
//  • Privacy is load-bearing (health data). Events carry event NAMES + minimal
//    NON-PII props only: counts, booleans, tiers, day-counts.
//    NEVER send food names, weights, calorie/macro values, pantry contents, or
//    any health value. When unsure, omit the prop.
//  • Off by default. No POSTHOG_KEY compiled in → [NoopAnalytics] does nothing
//    (tests + CI + privacy-conscious builds are unaffected).
//  • The key comes from --dart-define=POSTHOG_KEY=... (client-safe public
//    ingestion key). The host comes from --dart-define=POSTHOG_HOST=... and
//    defaults to the EU data-residency endpoint.

import 'package:posthog_flutter/posthog_flutter.dart';

// ── Abstract seam ────────────────────────────────────────────────────────────

abstract class Analytics {
  /// Record a named event with optional non-PII props.
  Future<void> capture(String event, {Map<String, Object>? props});

  /// Associate future events with a stable user identifier (Supabase user id).
  Future<void> identify(String userId);

  /// Wipe the current distinct-id on sign-out.
  Future<void> reset();
}

// ── Event-name constants ─────────────────────────────────────────────────────
//
// Keep all event names + property keys HERE so callers never have magic strings
// and a rename is one-place.

/// The user successfully signed in (or a session was restored on app launch).
const kEvtSignedIn = 'signed_in';

/// A weekly meal plan was generated successfully.
/// Props: [kPropDays] (int), [kPropGaps] (int).
const kEvtPlanGenerated = 'plan_generated';

/// Ingredient gaps from the current plan were added to the grocery cart.
/// Props: [kPropCount] (int).
const kEvtGapsAddedToCart = 'gaps_added_to_cart';

/// A planned meal was logged to the food diary (from the Plan page).
/// Props: [kPropDeducted] (bool — true when pantry was deducted).
const kEvtPlanMealLogged = 'plan_meal_logged';

/// Any meal was logged to the food diary (from the Nutrition page).
/// Props: [kPropTier] (String: 'exact' | 'estimate'), [kPropAteOut] (bool).
const kEvtMealLogged = 'meal_logged';

/// A weigh-in was saved (from the log-weight sheet).
const kEvtWeighInLogged = 'weigh_in_logged';

/// AI pantry recognition: items were confirmed and saved.
/// Props: [kPropCount] (int — number of items saved, never their names).
const kEvtPantryRecognized = 'pantry_recognized';

// ── Property-key constants ────────────────────────────────────────────────────

const kPropDays = 'days'; // int
const kPropGaps = 'gaps'; // int
const kPropCount = 'count'; // int
const kPropDeducted = 'deducted'; // bool
const kPropTier = 'tier'; // String
const kPropAteOut = 'ate_out'; // bool

// ── PostHog implementation ────────────────────────────────────────────────────

/// The real implementation. Wraps [Posthog] from posthog_flutter.
///
/// Only constructed when a POSTHOG_KEY dart-define is compiled in. The key is a
/// client-safe public ingestion key — never a secret.
class PostHogAnalytics implements Analytics {
  const PostHogAnalytics();

  @override
  Future<void> capture(String event, {Map<String, Object>? props}) async {
    try {
      await Posthog().capture(
        eventName: event,
        properties: props,
      );
    } catch (_) {
      // Analytics must never crash the app.
    }
  }

  @override
  Future<void> identify(String userId) async {
    try {
      await Posthog().identify(userId: userId);
    } catch (_) {
      // Analytics must never crash the app.
    }
  }

  @override
  Future<void> reset() async {
    try {
      await Posthog().reset();
    } catch (_) {
      // Analytics must never crash the app.
    }
  }
}

// ── Noop implementation ───────────────────────────────────────────────────────

/// All methods are no-ops. Used when no POSTHOG_KEY is compiled in (tests, CI,
/// privacy-conscious builds). This is the DEFAULT.
class NoopAnalytics implements Analytics {
  const NoopAnalytics();

  @override
  Future<void> capture(String event, {Map<String, Object>? props}) async {}

  @override
  Future<void> identify(String userId) async {}

  @override
  Future<void> reset() async {}
}
