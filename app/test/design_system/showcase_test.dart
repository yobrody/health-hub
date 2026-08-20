import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:health_hub/design_system/app_theme.dart';
import 'package:health_hub/design_system/colors.dart';
import 'package:health_hub/design_system/showcase.dart';

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<void> pumpShowcase(WidgetTester tester, ThemeData theme) async {
    await tester.pumpWidget(
      MaterialApp(theme: theme, home: const DesignShowcase()),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('DesignShowcase renders in the light theme without exceptions',
      (tester) async {
    await pumpShowcase(tester, lightTheme);
    expect(tester.takeException(), isNull);
    // Above the fold in the default test viewport.
    expect(find.text('Palette'), findsOneWidget);
    // The list is lazy, so scroll the later sections into view and confirm
    // they build cleanly (this also exercises overflow on each row).
    await tester.scrollUntilVisible(find.byType(FilledButton), 200);
    expect(find.byType(FilledButton), findsOneWidget);
    await tester.scrollUntilVisible(find.byType(Card), 200);
    expect(find.byType(Card), findsOneWidget);
    // Scroll to the (unambiguous) Chips section header, then confirm chips
    // built without exception.
    await tester.scrollUntilVisible(find.text('Chips'), 200);
    expect(find.byType(Chip), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('DesignShowcase renders in the dark theme without exceptions',
      (tester) async {
    await pumpShowcase(tester, darkTheme);
    expect(tester.takeException(), isNull);
    expect(find.text('Type'), findsOneWidget);
    await tester.scrollUntilVisible(find.byType(FilledButton), 200);
    expect(tester.takeException(), isNull);
  });

  testWidgets('context.appColors resolves the attached extension',
      (tester) async {
    late AppColors captured;
    await tester.pumpWidget(
      MaterialApp(
        theme: darkTheme,
        home: Builder(
          builder: (context) {
            captured = context.appColors;
            return const SizedBox();
          },
        ),
      ),
    );
    expect(captured.canvas, const Color(0xFF14110E));
  });
}
