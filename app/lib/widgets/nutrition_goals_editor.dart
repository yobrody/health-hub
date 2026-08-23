import 'package:flutter/material.dart';

import '../design_system/colors.dart';
import '../design_system/spacing.dart';
import '../nutrition/goal_suggestions.dart';
import '../nutrition/nutrition_goals.dart';
import '../nutrition/nutrition_goals_repo.dart';
import '../profile/profile_model.dart';

/// A calm "Daily targets" editor — calories + protein/carbs/fat.
///
/// **Honesty by construction.** A blank field saves as `null` (an unset target),
/// NEVER `0`/2200 — so an empty target leaves its dashboard ring in the honest
/// empty state. A genuine `0` the user types is preserved as a real value.
///
/// **"Suggest from your body"** (the [Key]`('goals-suggest-tdee')` affordance):
/// when the [profile] carries the real height / age / sex / weight / goal
/// direction, tapping it computes a TDEE-derived calorie + protein estimate
/// (Mifflin–St Jeor, see [suggestGoals]) and PREFILLS the fields with an honest
/// disclosure — the user still edits + Saves via the normal path (never a silent
/// auto-apply). If the profile is missing data, the affordance shows an honest
/// "complete your profile" prompt, NEVER a fabricated number. An activity level
/// is required for the estimate; if the profile hasn't got one, the user picks it
/// in the sheet (nothing is defaulted).
///
/// Returns `true` via [showNutritionGoalsEditor] when goals were saved, so the
/// caller can refresh; `null`/`false` on cancel.
class NutritionGoalsEditor extends StatefulWidget {
  const NutritionGoalsEditor({
    super.key,
    required this.repo,
    required this.current,
    this.profile,
  });

  final NutritionGoalsRepo repo;
  final NutritionGoals current;

  /// The user's profile — the ONLY source a TDEE suggestion is computed from.
  /// `null` (or an incomplete profile) means no honest suggestion can be made;
  /// the affordance then prompts the user to complete their profile.
  final Profile? profile;

  @override
  State<NutritionGoalsEditor> createState() => _NutritionGoalsEditorState();
}

class _NutritionGoalsEditorState extends State<NutritionGoalsEditor> {
  late final TextEditingController _kcalCtrl =
      TextEditingController(text: _initial(widget.current.caloriesKcal));
  late final TextEditingController _proteinCtrl =
      TextEditingController(text: _initial(widget.current.proteinG));
  late final TextEditingController _carbsCtrl =
      TextEditingController(text: _initial(widget.current.carbsG));
  late final TextEditingController _fatCtrl =
      TextEditingController(text: _initial(widget.current.fatG));

  bool _saving = false;

  /// A one-line honest disclosure shown after a suggestion is applied, so the
  /// prefilled numbers are never mistaken for saved/verified values. Null until
  /// the user taps "Suggest".
  String? _suggestionNote;

  /// Pre-fill with the existing target, or blank when unset (never a fake 0).
  static String _initial(double? v) {
    if (v == null) return '';
    return v == v.roundToDouble() ? v.round().toString() : v.toString();
  }

  @override
  void dispose() {
    _kcalCtrl.dispose();
    _proteinCtrl.dispose();
    _carbsCtrl.dispose();
    _fatCtrl.dispose();
    super.dispose();
  }

  /// Parse a field to a target: an empty/whitespace field → `null` (unset), a
  /// real number → that value. A non-numeric entry is treated as unset rather
  /// than a fabricated 0.
  double? _parse(TextEditingController c) {
    final t = c.text.trim();
    if (t.isEmpty) return null;
    return double.tryParse(t);
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final goals = NutritionGoals(
      caloriesKcal: _parse(_kcalCtrl),
      proteinG: _parse(_proteinCtrl),
      carbsG: _parse(_carbsCtrl),
      fatG: _parse(_fatCtrl),
    );
    await widget.repo.save(goals);
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  /// The profile fields needed for a suggestion, honestly evaluated (no
  /// fabrication). Returns `null` when height/age/sex/weight/direction aren't
  /// all present.
  bool get _profileComplete {
    final p = widget.profile;
    if (p == null) return false;
    return p.heightCm != null &&
        p.ageYears != null &&
        (p.sex != null && p.sex!.trim().isNotEmpty) &&
        p.weightKg != null &&
        p.goalDirection != null;
  }

  /// Handle the "Suggest from your body" tap.
  ///
  /// • Incomplete profile → an honest bottom sheet prompting the user to add the
  ///   missing data (NEVER a fabricated number).
  /// • Complete profile → determine the activity level (from the profile, else
  ///   ask in a picker), compute [suggestGoals], and PREFILL the calorie +
  ///   protein fields with a disclosure. Nothing is saved here.
  Future<void> _onSuggest() async {
    if (!_profileComplete) {
      await _showIncompleteProfilePrompt();
      return;
    }
    final p = widget.profile!;

    // Activity level: use the profile's if set, else ask (never default one in).
    // A picked-here level is used for THIS suggestion but is deliberately NOT
    // written back to the profile from this sheet — the goals editor owns goals,
    // not profile writes (that lives on the profile/onboarding screen). The cost
    // is only being asked again next time; nothing is fabricated or shown stale.
    var activity = ActivityLevel.fromName(p.activityLevel);
    activity ??= await _pickActivityLevel();
    if (activity == null) return; // user dismissed the picker — no suggestion.

    final suggestion = suggestGoals(
      heightCm: p.heightCm,
      ageYears: p.ageYears,
      sex: p.sex,
      weightKg: p.weightKg,
      activity: activity,
      direction: p.goalDirection,
    );
    // Defensive: _profileComplete guarantees non-null, but honour the null
    // contract rather than force-unwrap — a null here means "can't suggest".
    if (suggestion == null) {
      if (mounted) await _showIncompleteProfilePrompt();
      return;
    }

    setState(() {
      _kcalCtrl.text = _format(suggestion.calories);
      _proteinCtrl.text = _format(suggestion.protein);
      _suggestionNote = _disclosure(suggestion, activity!);
    });
  }

  /// Build the honest disclosure sentence for an applied suggestion.
  String _disclosure(GoalSuggestion s, ActivityLevel activity) {
    final base =
        'Estimated from your height, age, sex and weight (${activity.label.toLowerCase()}). '
        'Adjust as needed before saving.';
    if (s.usedAveragedSexConstant) {
      return '$base We averaged the male/female formula for your recorded sex, '
          'so treat this as a rougher estimate.';
    }
    return base;
  }

  /// A modal prompting the user to complete their profile — the honest path when
  /// there isn't enough real data to suggest anything.
  Future<void> _showIncompleteProfilePrompt() async {
    final missing = _missingFields();
    await showModalBottomSheet<void>(
      context: context,
      builder: (ctx) {
        final text = Theme.of(ctx).textTheme;
        final colors = ctx.appColors;
        return Padding(
          padding: EdgeInsets.only(
            left: AppSpacing.gutter,
            right: AppSpacing.gutter,
            top: AppSpacing.space5,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + AppSpacing.space6,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Add your body data first', style: text.titleLarge),
              AppSpacing.gapV2,
              Text(
                'A suggestion is only ever computed from your real profile — '
                'never a guessed number. Add your ${_joinMissing(missing)} in '
                'your profile and the estimate will appear here.',
                key: const Key('goals-suggest-incomplete'),
                style: text.bodyMedium?.copyWith(color: colors.textSecondary),
              ),
              AppSpacing.gapV5,
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: const Text('Got it'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  /// The human names of the profile fields still missing for a suggestion.
  List<String> _missingFields() {
    final p = widget.profile;
    return [
      if (p?.heightCm == null) 'height',
      if (p?.ageYears == null) 'age',
      if (p?.sex == null || (p?.sex?.trim().isEmpty ?? true)) 'sex',
      if (p?.weightKg == null) 'weight',
      if (p?.goalDirection == null) 'goal direction',
    ];
  }

  String _joinMissing(List<String> parts) {
    if (parts.isEmpty) return 'profile details';
    if (parts.length == 1) return parts.first;
    if (parts.length == 2) return '${parts[0]} and ${parts[1]}';
    return '${parts.sublist(0, parts.length - 1).join(', ')} and ${parts.last}';
  }

  /// Ask the user for their activity level when the profile hasn't got one.
  /// Returns the chosen level, or `null` if dismissed (→ no suggestion made).
  Future<ActivityLevel?> _pickActivityLevel() {
    return showModalBottomSheet<ActivityLevel>(
      context: context,
      builder: (ctx) {
        final text = Theme.of(ctx).textTheme;
        final colors = ctx.appColors;
        return SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.space5),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: AppSpacing.gutter),
                  child: Text('How active are you?', style: text.titleLarge),
                ),
                AppSpacing.gapV1,
                Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: AppSpacing.gutter),
                  child: Text(
                    'This scales your estimated burn — pick what fits.',
                    style:
                        text.bodySmall?.copyWith(color: colors.textSecondary),
                  ),
                ),
                AppSpacing.gapV3,
                for (final level in ActivityLevel.values)
                  ListTile(
                    key: Key('activity-${level.name}'),
                    title: Text(level.label),
                    subtitle: Text(level.description),
                    onTap: () => Navigator.of(ctx).pop(level),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  static String _format(double v) =>
      v == v.roundToDouble() ? v.round().toString() : v.toString();

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.gutter,
        right: AppSpacing.gutter,
        top: AppSpacing.space5,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.space6,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Daily targets', style: text.titleLarge),
          AppSpacing.gapV1,
          Text(
            'Leave a field blank to keep it unset — a blank target shows an '
            'empty ring, never a guessed number.',
            style: text.bodySmall?.copyWith(color: colors.textSecondary),
          ),
          AppSpacing.gapV3,
          // "Suggest from your body" — the honest TDEE affordance.
          OutlinedButton.icon(
            key: const Key('goals-suggest-tdee'),
            onPressed: _saving ? null : _onSuggest,
            icon: const Icon(Icons.auto_awesome_outlined, size: 18),
            label: const Text('Suggest from your body'),
          ),
          if (_suggestionNote != null) ...[
            AppSpacing.gapV2,
            Text(
              _suggestionNote!,
              key: const Key('goals-suggestion-note'),
              style: text.bodySmall?.copyWith(color: colors.primaryStrong),
            ),
          ],
          AppSpacing.gapV5,
          _field(const Key('goals-kcal'), _kcalCtrl, 'Calories', 'kcal'),
          AppSpacing.gapV3,
          _field(const Key('goals-protein'), _proteinCtrl, 'Protein', 'g'),
          AppSpacing.gapV3,
          _field(const Key('goals-carbs'), _carbsCtrl, 'Carbs', 'g'),
          AppSpacing.gapV3,
          _field(const Key('goals-fat'), _fatCtrl, 'Fat', 'g'),
          AppSpacing.gapV6,
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed:
                      _saving ? null : () => Navigator.of(context).pop(false),
                  child: const Text('Cancel'),
                ),
              ),
              AppSpacing.gapH3,
              Expanded(
                child: FilledButton(
                  key: const Key('goals-save'),
                  onPressed: _saving ? null : _save,
                  child: const Text('Save targets'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _field(
    Key key,
    TextEditingController c,
    String label,
    String unit,
  ) {
    return TextField(
      key: key,
      controller: c,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(
        labelText: label,
        suffixText: unit,
        border: const OutlineInputBorder(),
      ),
    );
  }
}

/// Present [NutritionGoalsEditor] as a modal bottom sheet. Resolves to `true`
/// when the user saved (so the caller can refresh), else `false`/`null`.
///
/// Pass [profile] so the "Suggest from your body" affordance can compute a
/// TDEE-derived estimate from real data; omit it (or pass an incomplete one) and
/// the affordance honestly prompts the user to complete their profile instead.
Future<bool?> showNutritionGoalsEditor(
  BuildContext context, {
  required NutritionGoalsRepo repo,
  required NutritionGoals current,
  Profile? profile,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) =>
        NutritionGoalsEditor(repo: repo, current: current, profile: profile),
  );
}
