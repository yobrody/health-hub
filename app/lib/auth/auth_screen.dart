import 'package:flutter/material.dart';

import '../design_system/colors.dart';
import '../design_system/shape.dart';
import '../design_system/spacing.dart';
import 'auth_service.dart';

/// The first screen a new user sees: sign in / sign up with email + password.
///
/// Styled with the luxury design system (creamsicle/obsidian) — calm and
/// premium. Honesty is baked in:
///  * Real [AuthFailure] messages are surfaced verbatim inline (never a fake
///    success).
///  * After a sign-up (autoconfirm OFF), the honest "check your email to
///    confirm" state is shown instead of routing into the app.
///  * Apple + phone buttons are visibly present but DISABLED, with an honest
///    "available soon" affordance — they never look functional.
///
/// [service] is injected so tests can pass a `FakeAuthService`. On a successful
/// sign-in the auth stream drives the gate; this screen doesn't navigate.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, required this.service});

  final AuthService service;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

enum _Mode { signIn, signUp }

class _AuthScreenState extends State<AuthScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();

  _Mode _mode = _Mode.signIn;
  bool _busy = false;
  String? _error;
  String? _info;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  bool get _isSignUp => _mode == _Mode.signUp;

  void _toggleMode() {
    setState(() {
      _mode = _isSignUp ? _Mode.signIn : _Mode.signUp;
      _error = null;
      _info = null;
    });
  }

  String? _validate() {
    final email = _email.text.trim();
    final pw = _password.text;
    if (email.isEmpty || !email.contains('@')) {
      return 'Enter a valid email address.';
    }
    if (pw.isEmpty) return 'Enter your password.';
    if (_isSignUp && pw.length < 6) {
      return 'Use a password of at least 6 characters.';
    }
    return null;
  }

  Future<void> _submit() async {
    if (_busy) return;
    final validationError = _validate();
    if (validationError != null) {
      setState(() {
        _error = validationError;
        _info = null;
      });
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });

    final email = _email.text.trim();
    final pw = _password.text;
    try {
      if (_isSignUp) {
        final result =
            await widget.service.signUpWithEmail(email: email, password: pw);
        if (!mounted) return;
        if (result.needsEmailConfirmation) {
          // Honest state: account created, but not usable until confirmed.
          setState(() {
            _info = 'Account created. Check $email for a confirmation link, '
                'then sign in.';
            _mode = _Mode.signIn;
            _password.clear();
          });
        }
        // If a session WAS established (autoconfirm on), the auth stream drives
        // the gate — nothing to do here.
      } else {
        await widget.service.signInWithEmail(email: email, password: pw);
        // Success → the auth stream routes the gate onward.
      }
    } on AuthFailure catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _forgotPassword() async {
    if (_busy) return;
    final email = _email.text.trim();
    if (email.isEmpty || !email.contains('@')) {
      setState(() {
        _error = 'Enter your email above first, then tap "Forgot password".';
        _info = null;
      });
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    try {
      await widget.service.sendPasswordReset(email: email);
      if (!mounted) return;
      setState(() {
        _info = 'If an account exists for $email, a reset link is on its way.';
      });
    } on AuthFailure catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Apple/phone are disabled — tapping the "available soon" note explains why,
  /// honestly. (The buttons themselves are non-interactive.)
  void _showComingSoon(String provider) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$provider sign-in is coming soon.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Scaffold(
      key: const Key('auth-screen'),
      backgroundColor: colors.canvas,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.gutter,
              vertical: AppSpacing.space8,
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: [
                  // ── Brand / hero ──────────────────────────────────────────
                  Text(
                    'Health Hub',
                    textAlign: TextAlign.center,
                    style: text.displaySmall?.copyWith(color: colors.primaryStrong),
                  ),
                  AppSpacing.gapV2,
                  Text(
                    _isSignUp
                        ? 'Create your account to sync across devices.'
                        : 'Welcome back — sign in to continue.',
                    textAlign: TextAlign.center,
                    style: text.bodyMedium?.copyWith(color: colors.textSecondary),
                  ),
                  AppSpacing.gapV8,

                  // ── Email ─────────────────────────────────────────────────
                  TextField(
                    key: const Key('auth-email'),
                    controller: _email,
                    enabled: !_busy,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      labelText: 'Email',
                      border: OutlineInputBorder(borderRadius: AppShape.field),
                    ),
                  ),
                  AppSpacing.gapV4,

                  // ── Password ──────────────────────────────────────────────
                  TextField(
                    key: const Key('auth-password'),
                    controller: _password,
                    enabled: !_busy,
                    obscureText: true,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (_) => _submit(),
                    decoration: const InputDecoration(
                      labelText: 'Password',
                      border: OutlineInputBorder(borderRadius: AppShape.field),
                    ),
                  ),

                  // ── Info / error (honest) ─────────────────────────────────
                  if (_info != null) ...[
                    AppSpacing.gapV4,
                    Text(
                      key: const Key('auth-info'),
                      _info!,
                      style: text.bodySmall?.copyWith(color: colors.accent),
                    ),
                  ],
                  if (_error != null) ...[
                    AppSpacing.gapV4,
                    Text(
                      key: const Key('auth-error'),
                      _error!,
                      style: text.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],

                  AppSpacing.gapV6,

                  // ── Primary action ────────────────────────────────────────
                  FilledButton(
                    key: const Key('auth-submit'),
                    onPressed: _busy ? null : _submit,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      shape: const RoundedRectangleBorder(
                        borderRadius: AppShape.button,
                      ),
                    ),
                    child: _busy
                        // A static label (not a spinner) so widget-test
                        // pumpAndSettle can settle.
                        ? const Text('Please wait…')
                        : Text(_isSignUp ? 'Create account' : 'Sign in'),
                  ),
                  AppSpacing.gapV3,

                  // ── Forgot password (sign-in only) ────────────────────────
                  if (!_isSignUp)
                    TextButton(
                      key: const Key('auth-forgot'),
                      onPressed: _busy ? null : _forgotPassword,
                      child: const Text('Forgot password?'),
                    ),

                  // ── Toggle sign-in / sign-up ──────────────────────────────
                  TextButton(
                    key: const Key('auth-toggle-mode'),
                    onPressed: _busy ? null : _toggleMode,
                    child: Text(
                      _isSignUp
                          ? 'Already have an account? Sign in'
                          : "Don't have an account? Sign up",
                    ),
                  ),

                  AppSpacing.gapV6,
                  _DividerLabel('or', colors: colors),
                  AppSpacing.gapV6,

                  // ── Apple / phone — present but DISABLED (honest) ─────────
                  _DisabledProviderButton(
                    key: const Key('auth-apple'),
                    icon: Icons.apple,
                    label: 'Continue with Apple',
                    onTapDisabled: () => _showComingSoon('Apple'),
                    colors: colors,
                  ),
                  AppSpacing.gapV3,
                  _DisabledProviderButton(
                    key: const Key('auth-phone'),
                    icon: Icons.phone_iphone,
                    label: 'Continue with phone',
                    onTapDisabled: () => _showComingSoon('Phone'),
                    colors: colors,
                  ),
                  AppSpacing.gapV3,
                  Text(
                    'Apple and phone sign-in are available soon.',
                    key: const Key('auth-providers-note'),
                    textAlign: TextAlign.center,
                    style: text.labelSmall?.copyWith(color: colors.textSecondary),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A hairline "— or —" divider with a centred label.
class _DividerLabel extends StatelessWidget {
  const _DividerLabel(this.label, {required this.colors});

  final String label;
  final AppColors colors;

  @override
  Widget build(BuildContext context) {
    final line = Expanded(child: Divider(color: colors.hairline, thickness: 1));
    return Row(
      children: [
        line,
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.space3),
          child: Text(
            label,
            style: Theme.of(context)
                .textTheme
                .labelSmall
                ?.copyWith(color: colors.textSecondary),
          ),
        ),
        line,
      ],
    );
  }
}

/// A provider button that LOOKS complete but is intentionally disabled. The
/// button surface is non-interactive (greyed) to communicate "not yet"; the
/// whole row is tappable only to explain *why* (an honest snackbar), never to
/// perform a fake sign-in.
class _DisabledProviderButton extends StatelessWidget {
  const _DisabledProviderButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTapDisabled,
    required this.colors,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTapDisabled;
  final AppColors colors;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Semantics(
      button: true,
      enabled: false,
      label: '$label, available soon',
      child: InkWell(
        onTap: onTapDisabled,
        borderRadius: AppShape.button,
        child: Opacity(
          opacity: 0.5,
          child: Container(
            height: 52,
            decoration: BoxDecoration(
              borderRadius: AppShape.button,
              border: Border.all(color: colors.hairline),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, size: 20, color: colors.textPrimary),
                AppSpacing.gapH2,
                Text(
                  label,
                  style: text.labelLarge?.copyWith(color: colors.textPrimary),
                ),
                AppSpacing.gapH2,
                Text(
                  'Soon',
                  style: text.labelSmall?.copyWith(color: colors.textSecondary),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
