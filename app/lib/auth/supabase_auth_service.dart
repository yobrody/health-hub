import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart' hide AuthUser;

import 'auth_service.dart';

/// The real [AuthService], wrapping Supabase's `GoTrueClient`
/// (`Supabase.instance.client.auth`).
///
/// Honesty rules enforced here:
///  * Every Supabase `AuthException` is mapped to an honest [AuthFailure]
///    message (see [_mapError]) — never swallowed into a fake success.
///  * A sign-up that requires email confirmation (autoconfirm OFF, which is the
///    live project's setting) returns `needsEmailConfirmation: true` and does
///    NOT report the user as signed-in.
///  * Apple / phone throw a clear "not enabled yet" [AuthFailure] because those
///    providers are disabled on the live project.
class SupabaseAuthService implements AuthService {
  SupabaseAuthService(this._auth);

  final GoTrueClient _auth;

  AuthUser? _toUser(User? u) {
    if (u == null) return null;
    return AuthUser(
      id: u.id,
      email: u.email,
      // `email_confirmed_at` is set only once the address is verified. Absent →
      // unconfirmed (the honest state right after sign-up with autoconfirm OFF).
      emailConfirmed: u.emailConfirmedAt != null,
    );
  }

  @override
  AuthUser? get currentUser => _toUser(_auth.currentUser);

  @override
  Stream<AuthUser?> authState() {
    // onAuthStateChange is a ReplaySubject, so a new listener immediately
    // receives the current state. Map each AuthState → our reduced AuthUser.
    return _auth.onAuthStateChange.map((state) => _toUser(state.session?.user));
  }

  @override
  Future<SignUpResult> signUpWithEmail({
    required String email,
    required String password,
  }) async {
    try {
      final res = await _auth.signUp(email: email, password: password);
      final user = _toUser(res.user);
      // No session established → email confirmation is required. This is the
      // live project's state (mailer_autoconfirm OFF): the account exists but
      // the user must confirm via the emailed link before signing in.
      final needsConfirm = res.session == null;
      return SignUpResult(user: user, needsEmailConfirmation: needsConfirm);
    } on AuthException catch (e) {
      throw _mapError(e);
    } catch (e) {
      throw _mapUnknown(e);
    }
  }

  @override
  Future<AuthUser> signInWithEmail({
    required String email,
    required String password,
  }) async {
    try {
      final res =
          await _auth.signInWithPassword(email: email, password: password);
      final user = _toUser(res.user);
      if (user == null) {
        // Defensive: a 200 with no user is not a real success — surface it.
        throw const AuthFailure(
          "Couldn't sign you in — please try again.",
        );
      }
      return user;
    } on AuthException catch (e) {
      throw _mapError(e);
    } on AuthFailure {
      rethrow;
    } catch (e) {
      throw _mapUnknown(e);
    }
  }

  @override
  Future<void> signOut() async {
    try {
      await _auth.signOut();
    } on AuthException catch (e) {
      throw _mapError(e);
    } catch (e) {
      throw _mapUnknown(e);
    }
  }

  @override
  Future<void> sendPasswordReset({required String email}) async {
    try {
      await _auth.resetPasswordForEmail(email);
    } on AuthException catch (e) {
      throw _mapError(e);
    } catch (e) {
      throw _mapUnknown(e);
    }
  }

  @override
  Future<AuthUser> signInWithApple() async {
    // Apple is DISABLED on the live Supabase project. Never fake a success.
    throw const AuthFailure(
      "Sign in with Apple isn't enabled yet.",
      code: 'provider_disabled',
    );
  }

  @override
  Future<AuthUser> signInWithPhone({required String phone}) async {
    // Phone/SMS is DISABLED on the live Supabase project. Never fake a success.
    throw const AuthFailure(
      "Phone sign-in isn't enabled yet.",
      code: 'provider_disabled',
    );
  }

  /// Map a Supabase [AuthException] to an honest, user-safe [AuthFailure].
  ///
  /// We branch on the documented error codes where they're stable, and fall
  /// back to the server's own message (which is already human-readable) so we
  /// never invent or soften what actually went wrong.
  AuthFailure _mapError(AuthException e) {
    final code = e.code;
    switch (code) {
      case 'invalid_credentials':
        return const AuthFailure(
          'Incorrect email or password.',
          code: 'invalid_credentials',
        );
      case 'email_not_confirmed':
        return const AuthFailure(
          'Your email isn\'t confirmed yet — check your inbox for the '
          'confirmation link.',
          code: 'email_not_confirmed',
        );
      case 'user_already_exists':
      case 'email_exists':
        return const AuthFailure(
          'An account with this email already exists — try signing in.',
          code: 'email_exists',
        );
      case 'weak_password':
        return AuthFailure(
          e.message.isNotEmpty
              ? e.message
              : 'That password is too weak — use at least 6 characters.',
          code: 'weak_password',
        );
      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit':
        return const AuthFailure(
          'Too many attempts — please wait a moment and try again.',
          code: 'rate_limited',
        );
      case 'validation_failed':
        return AuthFailure(
          e.message.isNotEmpty
              ? e.message
              : 'Please enter a valid email and password.',
          code: 'validation_failed',
        );
    }
    // A retryable fetch error means the request never reached the server.
    if (e is AuthRetryableFetchException) {
      return const AuthFailure(
        "Couldn't reach the server — check your connection and try again.",
        code: 'network',
      );
    }
    // Fall back to the server's human-readable message (never a fake success).
    return AuthFailure(
      e.message.isNotEmpty ? e.message : 'Something went wrong. Please try again.',
      code: code,
    );
  }

  AuthFailure _mapUnknown(Object e) {
    return const AuthFailure(
      'Something went wrong. Please try again.',
    );
  }
}
