import 'package:flutter/material.dart';

import '../design_system/colors.dart';
import '../design_system/spacing.dart';
import '../nutrition/nutrition_goals.dart';
import '../nutrition/nutrition_goals_repo.dart';

/// A calm "Daily targets" editor — calories + protein/carbs/fat.
///
/// **Honesty by construction.** A blank field saves as `null` (an unset target),
/// NEVER `0`/2200 — so an empty target leaves its dashboard ring in the honest
/// empty state. A genuine `0` the user types is preserved as a real value.
///
/// Returns `true` via [showNutritionGoalsEditor] when goals were saved, so the
/// caller can refresh; `null`/`false` on cancel.
class NutritionGoalsEditor extends StatefulWidget {
  const NutritionGoalsEditor({
    super.key,
    required this.repo,
    required this.current,
  });

  final NutritionGoalsRepo repo;
  final NutritionGoals current;

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
Future<bool?> showNutritionGoalsEditor(
  BuildContext context, {
  required NutritionGoalsRepo repo,
  required NutritionGoals current,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => NutritionGoalsEditor(repo: repo, current: current),
  );
}
