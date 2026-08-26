import 'dart:async';

/// The authenticated user, reduced to the fields the app actually needs.
///
/// Deliberately tiny: an [id] (the stable Supabase user id) and the [email].
/// [emailConfirmed] is honest — after a sign-up while `mailer_autoconfirm` is
/// OFF, Supabase returns a user whose email is NOT yet confirmed; we surface
/// that truthfully rather than pretending the account is live.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    required this.emailConfirmed,
  });

  final String id;
  final String? email;
  final bool emailConfirmed;

  @override
  bool operator ==(Object other) =>
      other is AuthUser &&
      other.id == id &&
      other.email == email &&
      other.emailConfirmed == emailConfirmed;

  @override
  int get hashCode => Object.hash(id, email, emailConfirmed);
}

/// A typed, human-readable auth error.
///
/// Every failure surfaced to the UI carries a [message] safe to show a user —
/// the concrete implementations map Supabase's `AuthException` (and network /
/// config errors) to honest, non-technical text. There is never a fake
/// "success": if auth didn't work, an [AuthFailure] is thrown.
class AuthFailure implements Exception {
  const AuthFailure(this.message, {this.code});

  /// A human-readable, honest message (shown in the UI verbatim).
  final String message;

  /// Optional machine code (e.g. the Supabase error code) for callers that want
  /// to branch — e.g. `email_not_confirmed`.
  final String? code;

  @override
  String toString() => 'AuthFailure($message)';
}

/// The outcome of a sign-up.
///
/// [needsEmailConfirmation] is the honest signal that `mailer_autoconfirm` is
/// OFF: the account exists but the user must click the link in their email
/// before they can sign in. The UI reflects this as "check your email" rather
/// than routing them into the app.
class SignUpResult {
  const SignUpResult({
    required this.user,
    required this.needsEmailConfirmation,
  });

  final AuthUser? user;
  final bool needsEmailConfirmation;
}

/// The auth abstraction the UI and gate depend on — so Supabase is swappable
/// and everything is testable with a [FakeAuthService].
///
/// Honesty contract:
///  * Only `email` auth is enabled on the live project right now, so only the
///    email methods do real work.
///  * [signInWithApple] / [signInWithPhone] exist for a complete interface, but
///    the real implementation throws an [AuthFailure] ("not enabled yet") — it
///    must NEVER report a fake success while the provider is disabled.
abstract class AuthService {
  /// The current user synchronously, if a session is already restored; else
  /// null. Handy for the gate's initial frame before the stream emits.
  AuthUser? get currentUser;

  /// Emits on every auth-state change (sign-in, sign-out, token refresh,
  /// session restore). Emits the current value on listen.
  Stream<AuthUser?> authState();

  /// Create an account with email + password. When email confirmation is
  /// required (autoconfirm OFF), returns [SignUpResult.needsEmailConfirmation]
  /// = true and does NOT establish a session. Throws [AuthFailure] on error.
  Future<SignUpResult> signUpWithEmail({
    required String email,
    required String password,
  });

  /// Sign in with email + password. Returns the signed-in [AuthUser]. Throws
  /// [AuthFailure] on wrong credentials / unconfirmed email / network error.
  Future<AuthUser> signInWithEmail({
    required String email,
    required String password,
  });

  /// Sign out the current session. Idempotent.
  Future<void> signOut();

  /// Permanently delete the current user's account and ALL their data on the
  /// server (via the `delete-account` edge function), then sign out locally.
  /// IRREVERSIBLE. Throws [AuthFailure] on error — and when it throws, nothing
  /// has been deleted, so the UI can safely tell the user it didn't happen.
  Future<void> deleteAccount();

  /// Send a password-reset email. Throws [AuthFailure] on error. Does not reveal
  /// whether the address exists (Supabase returns success either way).
  Future<void> sendPasswordReset({required String email});

  /// Apple sign-in — present for interface completeness. Not enabled on the
  /// live project, so the real impl throws an honest [AuthFailure].
  Future<AuthUser> signInWithApple();

  /// Phone sign-in — present for interface completeness. Not enabled on the
  /// live project, so the real impl throws an honest [AuthFailure].
  Future<AuthUser> signInWithPhone({required String phone});
}
