import 'dart:async';

import 'auth_service.dart';

/// An in-memory [AuthService] for tests and for the degraded local mode when
/// Supabase isn't configured (no `env.local.json` / dart-defines).
///
/// It faithfully models the honest behaviours the UI depends on:
///  * sign-up with [autoConfirm] false → `needsEmailConfirmation: true` and NO
///    session (mirrors the live project's `mailer_autoconfirm` OFF);
///  * a seedable [failNextWith] to drive the "honest error shows" test;
///  * registered credentials so sign-in can genuinely succeed or fail;
///  * Apple/phone throw the same honest "not enabled yet" [AuthFailure] as the
///    real impl — they are never a fake success.
class FakeAuthService implements AuthService {
  FakeAuthService({
    AuthUser? initialUser,
    this.autoConfirm = false,
  }) : _current = initialUser {
    _controller = StreamController<AuthUser?>.broadcast();
  }

  /// When false (the live-project default), sign-up does not create a session
  /// and reports that email confirmation is needed.
  final bool autoConfirm;

  AuthUser? _current;
  late final StreamController<AuthUser?> _controller;

  /// Registered accounts: email → password. Sign-up adds here; sign-in checks.
  final Map<String, String> _accounts = {};

  /// If set, the NEXT auth call throws this and clears it — lets a test drive
  /// the honest-error path deterministically.
  AuthFailure? failNextWith;

  AuthFailure? _takeFailure() {
    final f = failNextWith;
    failNextWith = null;
    return f;
  }

  @override
  AuthUser? get currentUser => _current;

  @override
  Stream<AuthUser?> authState() {
    // Replay the current value to each new listener (like Supabase's
    // ReplaySubject), then forward every subsequent change. Stream.multi gives
    // each subscriber the current state deterministically without leaving a
    // dangling async generator that could stall widget-test pumpAndSettle.
    return Stream.multi((controller) {
      controller.add(_current);
      final sub = _controller.stream.listen(
        controller.add,
        onError: controller.addError,
        onDone: controller.close,
      );
      controller.onCancel = sub.cancel;
    });
  }

  void _emit(AuthUser? user) {
    _current = user;
    _controller.add(user);
  }

  @override
  Future<SignUpResult> signUpWithEmail({
    required String email,
    required String password,
  }) async {
    final f = _takeFailure();
    if (f != null) throw f;
    _accounts[email] = password;
    final user = AuthUser(
      id: 'fake-${email.hashCode}',
      email: email,
      emailConfirmed: autoConfirm,
    );
    if (autoConfirm) {
      _emit(user);
      return SignUpResult(user: user, needsEmailConfirmation: false);
    }
    // Autoconfirm OFF → no session; user must confirm their email.
    return SignUpResult(user: user, needsEmailConfirmation: true);
  }

  @override
  Future<AuthUser> signInWithEmail({
    required String email,
    required String password,
  }) async {
    final f = _takeFailure();
    if (f != null) throw f;
    final expected = _accounts[email];
    if (expected != null && expected != password) {
      throw const AuthFailure(
        'Incorrect email or password.',
        code: 'invalid_credentials',
      );
    }
    final user = AuthUser(
      id: 'fake-${email.hashCode}',
      email: email,
      emailConfirmed: true,
    );
    _emit(user);
    return user;
  }

  @override
  Future<void> signOut() async {
    _emit(null);
  }

  @override
  Future<void> sendPasswordReset({required String email}) async {
    final f = _takeFailure();
    if (f != null) throw f;
    // No-op success (Supabase doesn't reveal whether the address exists).
  }

  @override
  Future<AuthUser> signInWithApple() async {
    throw const AuthFailure(
      "Sign in with Apple isn't enabled yet.",
      code: 'provider_disabled',
    );
  }

  @override
  Future<AuthUser> signInWithPhone({required String phone}) async {
    throw const AuthFailure(
      "Phone sign-in isn't enabled yet.",
      code: 'provider_disabled',
    );
  }

  /// Dispose the underlying stream controller.
  void dispose() => _controller.close();
}
