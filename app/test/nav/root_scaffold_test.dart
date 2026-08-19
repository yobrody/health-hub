import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/app.dart';

void main() {
  testWidgets('root nav switches tabs', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: HealthHubApp()));
    // starts on Today
    expect(find.byKey(const Key('today-page')), findsOneWidget);
    // has all 5 destinations
    for (final label in ['Today', 'Food', 'Gym', 'Nutrition', 'Settings']) {
      expect(find.text(label), findsWidgets);
    }
    // tapping Gym shows the gym page
    await tester.tap(find.text('Gym'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('gym-page')), findsOneWidget);
  });
}
