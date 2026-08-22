// Widget tests for the shared InsightCard — the Brain's connected card.
//
// Contracts:
//  • renders title, detail, kind chip; keyed Key('insight-card-<id>').
//  • the `↳ why` toggle expands to show the real WhyFact rows.
//  • the action button fires onAction with the insight's real action.
//  • a setup insight (no why, no action) renders without a why toggle/button.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/brain/insight.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/design_system/components/insight_card.dart';

Widget _wrap(Insight insight, {void Function(InsightAction)? onAction}) =>
    MaterialApp(
      theme: lightTheme,
      home: Scaffold(
        body: SingleChildScrollView(
          child: InsightCard(insight: insight, onAction: onAction),
        ),
      ),
    );

const _eat = Insight(
  id: 'eat',
  kind: InsightKind.eat,
  title: '550 kcal left today',
  detail: 'You have chicken + yogurt.',
  why: [
    WhyFact(label: 'Calorie goal', value: '2000 kcal'),
    WhyFact(label: 'Eaten today', value: '1450 kcal'),
  ],
  action: InsightAction(kind: InsightActionKind.logMeal, label: 'Log a meal'),
);

void main() {
  testWidgets('renders title, detail, chip, keyed card', (tester) async {
    await tester.pumpWidget(_wrap(_eat));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('insight-card-eat')), findsOneWidget);
    expect(find.text('550 kcal left today'), findsOneWidget);
    expect(find.text('You have chicken + yogurt.'), findsOneWidget);
    expect(find.text('EAT'), findsOneWidget);
  });

  testWidgets('why is collapsed by default, expands on toggle', (tester) async {
    await tester.pumpWidget(_wrap(_eat));
    await tester.pumpAndSettle();

    // Collapsed: the why fact values are not shown yet.
    expect(find.text('2000 kcal'), findsNothing);

    await tester.tap(find.byKey(const Key('insight-why-eat')));
    await tester.pumpAndSettle();

    // Expanded: the REAL why facts are now visible.
    expect(find.text('Calorie goal'), findsOneWidget);
    expect(find.text('2000 kcal'), findsOneWidget);
    expect(find.text('Eaten today'), findsOneWidget);
    expect(find.text('1450 kcal'), findsOneWidget);
  });

  testWidgets('action button fires onAction with the real action',
      (tester) async {
    InsightAction? fired;
    await tester.pumpWidget(_wrap(_eat, onAction: (a) => fired = a));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('insight-action-eat')));
    await tester.pumpAndSettle();

    expect(fired, isNotNull);
    expect(fired!.kind, InsightActionKind.logMeal);
    expect(fired!.label, 'Log a meal');
  });

  testWidgets('a setup insight shows no why toggle and its own action',
      (tester) async {
    const setup = Insight(
      id: 'eat-setup',
      kind: InsightKind.setup,
      title: 'Set a daily goal to see what to eat',
      detail: 'Add a target.',
      action: InsightAction(kind: InsightActionKind.openGoals, label: 'Set goals'),
    );
    InsightAction? fired;
    await tester.pumpWidget(_wrap(setup, onAction: (a) => fired = a));
    await tester.pumpAndSettle();

    // No why toggle (a setup prompt has no facts).
    expect(find.byKey(const Key('insight-why-eat-setup')), findsNothing);
    expect(find.text('SET UP'), findsOneWidget);

    await tester.tap(find.byKey(const Key('insight-action-eat-setup')));
    await tester.pumpAndSettle();
    expect(fired?.kind, InsightActionKind.openGoals);
  });

  testWidgets('an addToCart action carries the real payload', (tester) async {
    const buy = Insight(
      id: 'buy-p-Milk',
      kind: InsightKind.buy,
      title: 'Restock Milk',
      detail: "It's running low.",
      why: [WhyFact(label: 'In stock', value: '20 g')],
      action: InsightAction(
        kind: InsightActionKind.addToCart,
        label: 'Add to list',
        payload: 'Milk',
      ),
    );
    InsightAction? fired;
    await tester.pumpWidget(_wrap(buy, onAction: (a) => fired = a));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('insight-action-buy-p-Milk')));
    await tester.pumpAndSettle();
    expect(fired?.kind, InsightActionKind.addToCart);
    expect(fired?.payload, 'Milk');
  });
}
