// Unit tests for FakeAuthService — the in-memory AuthService used by tests and
// the degraded local mode. Verifies the honest behaviours the UI relies on.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/auth/auth_service.dart';
import 'package:health_hub/auth/fake_auth_service.dart';

void main() {
  group('FakeAuthService', () {
    test('sign-up with autoconfirm OFF → needs confirmation, no session',
        () async {
      final s = FakeAuthService(autoConfirm: false);
      final result =
          await s.signUpWithEmail(email: 'a@b.com', password: 'secret123');
      expect(result.needsEmailConfirmation, isTrue);
      expect(s.currentUser, isNull); // no session established
      s.dispose();
    });

    test('sign-up with autoconfirm ON → signed in immediately', () async {
      final s = FakeAuthService(autoConfirm: true);
      final result =
          await s.signUpWithEmail(email: 'a@b.com', password: 'secret123');
      expect(result.needsEmailConfirmation, isFalse);
      expect(s.currentUser?.email, 'a@b.com');
      s.dispose();
    });

    test('sign-in with a wrong password throws an honest AuthFailure',
        () async {
      final s = FakeAuthService();
      await s.signUpWithEmail(email: 'a@b.com', password: 'right-one');
      expect(
        () => s.signInWithEmail(email: 'a@b.com', password: 'wrong'),
        throwsA(isA<AuthFailure>()),
      );
      s.dispose();
    });

    test('signOut emits null on the auth stream', () async {
      final s = FakeAuthService(
        initialUser:
            const AuthUser(id: 'u', email: 'a@b.com', emailConfirmed: true),
      );
      expect(s.currentUser, isNotNull);
      await s.signOut();
      expect(s.currentUser, isNull);
      s.dispose();
    });

    test('Apple + phone throw an honest "not enabled" AuthFailure', () async {
      final s = FakeAuthService();
      await expectLater(s.signInWithApple(), throwsA(isA<AuthFailure>()));
      await expectLater(
          s.signInWithPhone(phone: '+15550100'), throwsA(isA<AuthFailure>()));
      s.dispose();
    });

    test('authState replays the current value to new listeners', () async {
      final s = FakeAuthService(
        initialUser:
            const AuthUser(id: 'u', email: 'a@b.com', emailConfirmed: true),
      );
      final first = await s.authState().first;
      expect(first?.email, 'a@b.com');
      s.dispose();
    });
  });
}
