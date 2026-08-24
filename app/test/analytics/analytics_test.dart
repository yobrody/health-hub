// Unit tests for the analytics seam.
//
// Verifies:
//  1. NoopAnalytics all methods are genuine no-ops (no throw, no side-effect).
//  2. Event-name and prop-key constants are stable (a rename shows up here).
//  3. FakeAnalytics records events correctly for use in widget tests.
//  4. No PII in any prop key defined in the seam.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/analytics/analytics.dart';

import 'fake_analytics.dart';

void main() {
  group('NoopAnalytics', () {
    final noop = const NoopAnalytics();

    test('capture does not throw', () async {
      await expectLater(
        noop.capture('any_event', props: {'k': 1}),
        completes,
      );
    });

    test('identify does not throw', () async {
      await expectLater(noop.identify('some-user-id'), completes);
    });

    test('reset does not throw', () async {
      await expectLater(noop.reset(), completes);
    });
  });

  group('Event-name constants are stable', () {
    test('kEvtSignedIn', () => expect(kEvtSignedIn, 'signed_in'));
    test('kEvtPlanGenerated', () => expect(kEvtPlanGenerated, 'plan_generated'));
    test('kEvtGapsAddedToCart',
        () => expect(kEvtGapsAddedToCart, 'gaps_added_to_cart'));
    test('kEvtPlanMealLogged',
        () => expect(kEvtPlanMealLogged, 'plan_meal_logged'));
    test('kEvtMealLogged', () => expect(kEvtMealLogged, 'meal_logged'));
    test('kEvtWeighInLogged',
        () => expect(kEvtWeighInLogged, 'weigh_in_logged'));
    test('kEvtPantryRecognized',
        () => expect(kEvtPantryRecognized, 'pantry_recognized'));
  });

  group('Prop-key constants — no PII keys defined', () {
    const allPropKeys = [
      kPropDays,
      kPropGaps,
      kPropCount,
      kPropDeducted,
      kPropTier,
      kPropAteOut,
    ];

    // None of the prop keys should look like health data.
    const forbiddenSubstrings = [
      'kcal', 'calorie', 'protein', 'carb', 'fat', 'weight', 'kg',
      'name', 'food', 'meal', 'recipe', 'pantry', 'ingredient', 'gram',
      'email', 'phone', 'address',
    ];

    for (final key in allPropKeys) {
      test('$key contains no PII term', () {
        for (final bad in forbiddenSubstrings) {
          expect(
            key.toLowerCase().contains(bad),
            isFalse,
            reason: 'prop key "$key" contains PII-adjacent term "$bad"',
          );
        }
      });
    }
  });

  group('FakeAnalytics', () {
    test('records events in order', () async {
      final fake = FakeAnalytics();
      await fake.capture('first', props: {'a': 1});
      await fake.capture('second');
      expect(fake.eventNames, ['first', 'second']);
    });

    test('propsFor returns last props for named event', () async {
      final fake = FakeAnalytics();
      await fake.capture(kEvtPlanGenerated, props: {kPropDays: 7, kPropGaps: 2});
      final props = fake.propsFor(kEvtPlanGenerated);
      expect(props, {kPropDays: 7, kPropGaps: 2});
    });

    test('propsFor returns null when event not fired', () {
      final fake = FakeAnalytics();
      expect(fake.propsFor('not_fired'), isNull);
    });
  });
}
