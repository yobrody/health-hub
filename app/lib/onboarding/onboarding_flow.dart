import 'package:flutter/material.dart';

import '../design_system/colors.dart';
import '../design_system/spacing.dart';
import '../profile/profile_model.dart';
import '../profile/profile_repo.dart';

/// One field collected during onboarding.
enum _Field { height, age, sex, weight, goalDirection, targetWeight, gym }

const List<_Field> _order = [
  _Field.height,
  _Field.age,
  _Field.sex,
  _Field.weight,
  _Field.goalDirection,
  _Field.targetWeight,
  _Field.gym,
];

/// First-run onboarding.
///
/// Collects height, age, sex, current weight, goal direction, goal weight, and
/// primary gym — one step at a time. **Every field is skippable.** A skipped
/// field stays `null`; NOTHING is defaulted. On finish the (possibly sparse)
/// [Profile] is saved via [ProfileRepo] and [onDone] fires.
///
/// This is the honesty rule at the point of data entry: the user is never
/// pushed to invent a value, and a value they decline is preserved as "not
/// provided" (`null`), which the rest of the app renders as `—`.
class OnboardingFlow extends StatefulWidget {
  const OnboardingFlow({
    super.key,
    required this.repo,
    required this.onDone,
  });

  final ProfileRepo repo;
  final VoidCallback onDone;

  @override
  State<OnboardingFlow> createState() => _OnboardingFlowState();
}

class _OnboardingFlowState extends State<OnboardingFlow> {
  int _step = 0;
  Profile _profile = const Profile();
  final TextEditingController _input = TextEditingController();

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  _Field get _current => _order[_step];

  void _advance() {
    if (_step >= _order.length - 1) {
      _finish();
      return;
    }
    setState(() {
      _step++;
      _input.clear();
    });
  }

  Future<void> _finish() async {
    // Save whatever was actually provided — often a sparse profile. A skipped
    // field is null and stays null. Offline saves route through the Outbox and
    // are reported as queued-success, so we never block onboarding on the
    // network.
    await widget.repo.save(_profile);
    widget.onDone();
  }

  /// Skip: advance without recording anything → the field stays null.
  void _skip() => _advance();

  /// Next: record the entered value (if any) then advance. An empty/blank
  /// input is treated as a skip — we do NOT store an empty string or a 0.
  void _next() {
    final text = _input.text.trim();
    if (text.isNotEmpty) {
      _record(text);
    }
    _advance();
  }

  void _record(String text) {
    switch (_current) {
      case _Field.height:
        final v = double.tryParse(text);
        if (v != null) _profile = _profile.copyWith(heightCm: v);
        break;
      case _Field.age:
        final v = int.tryParse(text);
        if (v != null) _profile = _profile.copyWith(ageYears: v);
        break;
      case _Field.sex:
        _profile = _profile.copyWith(sex: text);
        break;
      case _Field.weight:
        final v = double.tryParse(text);
        if (v != null) _profile = _profile.copyWith(weightKg: v);
        break;
      case _Field.goalDirection:
        _profile = _profile.copyWith(goalDirection: text);
        break;
      case _Field.targetWeight:
        final v = double.tryParse(text);
        if (v != null) _profile = _profile.copyWith(targetWeightKg: v);
        break;
      case _Field.gym:
        _profile = _profile.copyWith(primaryGym: text);
        break;
    }
  }

  // ── Per-step presentation ──────────────────────────────────────────────────

  String get _title {
    switch (_current) {
      case _Field.height:
        return 'Your height';
      case _Field.age:
        return 'Your age';
      case _Field.sex:
        return 'Your sex';
      case _Field.weight:
        return 'Your current weight';
      case _Field.goalDirection:
        return 'Your goal';
      case _Field.targetWeight:
        return 'Your goal weight';
      case _Field.gym:
        return 'Your primary gym';
    }
  }

  String get _hint {
    switch (_current) {
      case _Field.height:
        return 'cm (e.g. 178)';
      case _Field.age:
        return 'years (e.g. 29)';
      case _Field.sex:
        return 'male / female / …';
      case _Field.weight:
        return 'kg (e.g. 62.5)';
      case _Field.goalDirection:
        return 'gain / cut / maintain';
      case _Field.targetWeight:
        return 'kg (e.g. 72)';
      case _Field.gym:
        return 'e.g. PureGym';
    }
  }

  bool get _numeric =>
      _current == _Field.height ||
      _current == _Field.age ||
      _current == _Field.weight ||
      _current == _Field.targetWeight;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final progress = (_step + 1) / _order.length;

    return Scaffold(
      key: const Key('onboarding-flow'),
      backgroundColor: colors.canvas,
      appBar: AppBar(
        backgroundColor: colors.canvas,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        automaticallyImplyLeading: false,
        // Step counter in place of the title — keeps the appbar minimal
        title: Text(
          'Step ${_step + 1} of ${_order.length}',
          style: text.labelMedium?.copyWith(
            color: colors.textSecondary,
            letterSpacing: 0.8,
          ),
        ),
        centerTitle: false,
      ),
      body: SafeArea(
        child: Padding(
          padding: AppSpacing.pagePadding,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // ── Progress bar ──────────────────────────────────────────────
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: progress,
                  minHeight: 4,
                  backgroundColor: colors.hairline,
                  valueColor:
                      AlwaysStoppedAnimation<Color>(colors.primaryStrong),
                ),
              ),

              AppSpacing.gapV8,

              // ── Step title ────────────────────────────────────────────────
              Text(
                _title,
                style: text.headlineLarge?.copyWith(
                  color: colors.textPrimary,
                ),
              ),

              AppSpacing.gapV3,

              // ── Honesty disclaimer ────────────────────────────────────────
              Text(
                'Every step is optional — skip anything you\'d rather not '
                'share. Skipped details show as "—" and never as a guessed '
                'value.',
                style: text.bodyMedium?.copyWith(
                  color: colors.textSecondary,
                  height: 1.5,
                ),
              ),

              AppSpacing.gapV6,

              // ── Input field ───────────────────────────────────────────────
              TextField(
                key: const Key('onboarding-input'),
                controller: _input,
                keyboardType: _numeric
                    ? const TextInputType.numberWithOptions(decimal: true)
                    : TextInputType.text,
                style: text.bodyLarge?.copyWith(color: colors.textPrimary),
                decoration: InputDecoration(
                  labelText: _hint,
                  labelStyle: TextStyle(color: colors.textSecondary),
                  border: const OutlineInputBorder(),
                  focusedBorder: OutlineInputBorder(
                    borderSide:
                        BorderSide(color: colors.primaryStrong, width: 2),
                  ),
                ),
                onSubmitted: (_) => _next(),
              ),

              const Spacer(),

              // ── Navigation buttons ────────────────────────────────────────
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      key: const Key('onboarding-skip'),
                      onPressed: _skip,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: colors.textSecondary,
                        side: BorderSide(color: colors.hairline),
                        padding: const EdgeInsets.symmetric(
                          vertical: AppSpacing.space4,
                        ),
                      ),
                      child: const Text('Skip'),
                    ),
                  ),
                  AppSpacing.gapH4,
                  Expanded(
                    child: FilledButton(
                      key: const Key('onboarding-next'),
                      onPressed: _next,
                      style: FilledButton.styleFrom(
                        backgroundColor: colors.primaryStrong,
                        foregroundColor: colors.textPrimary,
                        padding: const EdgeInsets.symmetric(
                          vertical: AppSpacing.space4,
                        ),
                      ),
                      child: Text(
                        _step >= _order.length - 1 ? 'Finish' : 'Next',
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
