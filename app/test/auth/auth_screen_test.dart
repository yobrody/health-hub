// Widget tests for AuthScreen (P4-D1) using the in-memory FakeAuthService.
//
// Honesty invariants under test:
//  • The screen renders (design-system styled) with its stable Key.
//  • Email sign-in success emits a signed-in user on the auth stream.
//  • Sign-in failure surfaces the honest AuthFailure message inline — no fake
//    success, no navigation.
//  • Sign-up with autoconfirm OFF shows the truthful "check your email" state.
//  • Apple + phone buttons are PRESENT but DISABLED (never functional).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/auth/auth_screen.dart';
import 'package:health_hub/auth/auth_service.dart';
import 'package:health_hub/auth/fake_auth_service.dart';
import 'package:health_hub/design_system/app_theme.dart';

Widget _wrap(FakeAuthService service) => MaterialApp(
      theme: lightTheme,
      home: AuthScreen(service: service),
    );

void main() {
  group('AuthScreen', () {
    testWidgets('renders with the design-system theme + stable Key',
        (tester) async {
      final service = FakeAuthService();
      await tester.pumpWidget(_wrap(service));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('auth-screen')), findsOneWidget);
      expect(find.byKey(const Key('auth-email')), findsOneWidget);
      expect(find.byKey(const Key('auth-password')), findsOneWidget);
      expect(find.byKey(const Key('auth-submit')), findsOneWidget);
      // The luxury design system paints the canvas colour on the Scaffold.
      final scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
      expect(scaffold.backgroundColor, isNotNull);

      service.dispose();
    });

    testWidgets('email sign-in success → user signed in, no error',
        (tester) async {
      // Register an account so sign-in genuinely succeeds.
      final service = FakeAuthService();
      await service.signUpWithEmail(
          email: 'brody@example.com', password: 'secret123');

      await tester.pumpWidget(_wrap(service));
      await tester.pumpAndSettle();

      await tester.enterText(
          find.byKey(const Key('auth-email')), 'brody@example.com');
      await tester.enterText(
          find.byKey(const Key('auth-password')), 'secret123');
      await tester.tap(find.byKey(const Key('auth-submit')));
      // pump (not pumpAndSettle) — a live auth-state subscription is an ongoing
      // stream, so we advance frames explicitly rather than waiting for quiet.
      await tester.pump();
      await tester.pump();

      // No error surfaced; the service now reports a signed-in user (this is
      // what the gate watches to route onward). The stream carries the same
      // value — verified directly in fake_auth_service_test.dart.
      expect(find.byKey(const Key('auth-error')), findsNothing);
      expect(service.currentUser, isNotNull);
      expect(service.currentUser?.email, 'brody@example.com');

      service.dispose();
    });

    testWidgets('sign-in failure → honest error message shows, no success',
        (tester) async {
      final service = FakeAuthService()
        ..failNextWith = const AuthFailure('Incorrect email or password.');

      await tester.pumpWidget(_wrap(service));
      await tester.pumpAndSettle();

      await tester.enterText(
          find.byKey(const Key('auth-email')), 'brody@example.com');
      await tester.enterText(
          find.byKey(const Key('auth-password')), 'wrongpass');
      await tester.tap(find.byKey(const Key('auth-submit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('auth-error')), findsOneWidget);
      expect(find.text('Incorrect email or password.'), findsOneWidget);
      // No user was signed in.
      expect(service.currentUser, isNull);

      service.dispose();
    });

    testWidgets('sign-up (autoconfirm OFF) → "check your email" state, no session',
        (tester) async {
      // autoConfirm defaults to false — mirrors the live project.
      final service = FakeAuthService();
      await tester.pumpWidget(_wrap(service));
      await tester.pumpAndSettle();

      // Toggle to sign-up mode.
      await tester.tap(find.byKey(const Key('auth-toggle-mode')));
      await tester.pumpAndSettle();

      await tester.enterText(
          find.byKey(const Key('auth-email')), 'new@example.com');
      await tester.enterText(
          find.byKey(const Key('auth-password')), 'secret123');
      await tester.tap(find.byKey(const Key('auth-submit')));
      await tester.pumpAndSettle();

      // Honest confirmation state shown; NOT routed into the app.
      expect(find.byKey(const Key('auth-info')), findsOneWidget);
      expect(
        find.textContaining('Check new@example.com'),
        findsOneWidget,
      );
      // No session established.
      expect(service.currentUser, isNull);

      service.dispose();
    });

    testWidgets('Apple + phone buttons are present but DISABLED', (tester) async {
      final service = FakeAuthService();
      await tester.pumpWidget(_wrap(service));
      await tester.pumpAndSettle();

      // Both buttons are present.
      expect(find.byKey(const Key('auth-apple')), findsOneWidget);
      expect(find.byKey(const Key('auth-phone')), findsOneWidget);
      // An honest "available soon" note is shown.
      expect(find.byKey(const Key('auth-providers-note')), findsOneWidget);

      // The disabled buttons expose a "available soon" Semantics affordance —
      // they are never presented as a functional sign-in path.
      expect(
        find.bySemanticsLabel(RegExp('available soon')),
        findsWidgets,
      );

      // Even if the explainer is tapped, no user is ever signed in.
      await tester.tap(find.byKey(const Key('auth-apple')));
      await tester.pumpAndSettle();
      expect(service.currentUser, isNull);

      service.dispose();
    });

    testWidgets('validation blocks a bad email before any service call',
        (tester) async {
      final service = FakeAuthService();
      await tester.pumpWidget(_wrap(service));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('auth-email')), 'notanemail');
      await tester.enterText(
          find.byKey(const Key('auth-password')), 'secret123');
      await tester.tap(find.byKey(const Key('auth-submit')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('auth-error')), findsOneWidget);
      expect(service.currentUser, isNull);

      service.dispose();
    });
  });
}
