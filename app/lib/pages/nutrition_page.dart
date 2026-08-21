// Nutrition capture page (P2-T4).
//
// Supports three entry paths:
//   • Manual: user types name + grams + optional macros → Log (exact) or Guess
//     (estimate, shown with ~).
//   • Barcode: scanner seam [handleBarcodeResult] resolves via OffClient and
//     pre-fills the form; Log then commits a scaled exact entry.
//   • In/Out toggle: Out mode captures restaurant + £spend and sets
//     ateOut=true WITHOUT touching the pantry — the repo is pantry-agnostic.
//
// Honesty rules:
//  • Macros filled by user OR from barcode → AccuracyTier.exact.
//  • Guess button → AccuracyTier.estimate; name gets a '~' prefix.
//  • Unmeasured macro field = null in the stored entry (never fabricated 0).
//  • Out entries record ateOut + restaurant + spendGbp; no pantry interaction.
//  • Today's log shown at the bottom via showOrDash for null macro display.
//
// Scanner seam: [handleBarcodeResult] is public so widget tests can inject a
// barcode string directly without opening the real camera.
// _InlineMobileScanner (which wraps MobileScanner) is only pumped when the
// scanner route is actually pushed — never during widget tests.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../app_providers.dart';
import '../design_system/colors.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/motion.dart';
import '../design_system/shape.dart';
import '../design_system/spacing.dart';
import '../meals/eat_in_service.dart';
import '../meals/meal_composition.dart';
import '../nutrition/food_log_entry.dart';
import '../nutrition/nutrition_repo.dart';
import '../nutrition/off_client.dart';
import '../nutrition/packaged_food_model.dart';
import '../pantry/pantry_item.dart';
import '../pantry/pantry_repo.dart';
import '../profile/profile_model.dart'; // showOrDash

// ── NutritionPage ─────────────────────────────────────────────────────────────

class NutritionPage extends ConsumerStatefulWidget {
  const NutritionPage({super.key});

  @override
  NutritionPageState createState() => NutritionPageState();
}

/// The mutable state for [NutritionPage].
///
/// [handleBarcodeResult] is intentionally public (not prefixed with `_`) so
/// widget tests can drive the scanner seam directly without a camera.
class NutritionPageState extends ConsumerState<NutritionPage> {
  // ── Form controllers ───────────────────────────────────────────────────────

  final _nameCtrl = TextEditingController();
  final _gramsCtrl = TextEditingController();
  final _kcalCtrl = TextEditingController();
  final _proteinCtrl = TextEditingController();
  final _carbsCtrl = TextEditingController();
  final _fatCtrl = TextEditingController();
  final _restaurantCtrl = TextEditingController();
  final _spendCtrl = TextEditingController();

  // ── State ──────────────────────────────────────────────────────────────────

  /// In = eating at home (default). Out = eating out.
  bool _ateOut = false;

  /// Barcode that was scanned (set when coming via the scanner seam).
  String? _scannedBarcode;

  /// Scaled nutrition from barcode lookup (set when scanner returns a hit).
  Map<String, double?>? _barcodeNutrition;

  /// Today's food log (refreshed after each Log submission).
  List<FoodLogEntry> _todayLog = [];

  /// OPTIONAL pantry ingredients attached to an In (home) meal. When non-empty,
  /// logging the meal ALSO deducts these from the pantry via [EatInService].
  /// Empty by default — the existing "log a meal with no ingredients" path is
  /// unchanged and never forced through the ingredient flow.
  final List<_ChosenIngredient> _ingredients = [];

  bool _loading = false;

  // ── Providers ──────────────────────────────────────────────────────────────

  NutritionRepo get _repo => ref.read(nutritionRepoProvider);
  OffClient get _offClient => ref.read(offClientProvider);
  PantryRepo get _pantryRepo => ref.read(pantryRepoProvider);
  EatInService get _eatIn => ref.read(eatInServiceProvider);

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  @override
  void initState() {
    super.initState();
    _reloadLog();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _gramsCtrl.dispose();
    _kcalCtrl.dispose();
    _proteinCtrl.dispose();
    _carbsCtrl.dispose();
    _fatCtrl.dispose();
    _restaurantCtrl.dispose();
    _spendCtrl.dispose();
    super.dispose();
  }

  // ── Log reload ─────────────────────────────────────────────────────────────

  Future<void> _reloadLog() async {
    final all = await _repo.all();
    if (!mounted) return;
    setState(() {
      _todayLog = _repo.logsForDay(all, DateTime.now());
    });
  }

  // ── Scanner seam ───────────────────────────────────────────────────────────

  /// Public seam: takes a barcode string (from scanner OR test), resolves via
  /// [OffClient], and pre-fills the form if a product is found.
  ///
  /// Widget tests call this directly to drive the barcode flow without a
  /// camera. On a real device [_openScanner] calls this after getting a scan.
  Future<void> handleBarcodeResult(String code) async {
    setState(() => _loading = true);

    try {
      final PackagedFood? food = await _offClient.lookupBarcode(code);
      if (!mounted) return;

      if (food == null) {
        // No result — let the user fill in manually; clear any stale barcode.
        setState(() {
          _scannedBarcode = null;
          _barcodeNutrition = null;
          _loading = false;
        });
        return;
      }

      // Determine serving grams: use the product's own serving if available,
      // else fall back to per-100g (100 g) so the user can adjust.
      final servingGrams = food.servingGrams ?? 100.0;
      final nutrition = food.toServing(servingGrams);

      setState(() {
        _scannedBarcode = code;
        _barcodeNutrition = nutrition;
        _loading = false;

        // Pre-fill name with product name or blank for user to confirm.
        if (food.name != null) {
          _nameCtrl.text = food.name!;
        }
        // Pre-fill grams with the serving size.
        _gramsCtrl.text = servingGrams.toStringAsFixed(0);

        // Pre-fill macro fields only when the scaled value is non-null.
        final kcal = nutrition['kcal'];
        if (kcal != null) _kcalCtrl.text = kcal.toStringAsFixed(0);

        final protein = nutrition['proteinG'];
        if (protein != null) _proteinCtrl.text = protein.toStringAsFixed(1);

        final carbs = nutrition['carbsG'];
        if (carbs != null) _carbsCtrl.text = carbs.toStringAsFixed(1);

        final fat = nutrition['fatG'];
        if (fat != null) _fatCtrl.text = fat.toStringAsFixed(1);
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  /// Opens the real device camera scanner.
  /// Only called on real devices — never in widget tests (the route push is
  /// never triggered in tests).
  Future<void> _openScanner() async {
    final String? code = await Navigator.of(context).push<String>(
      MaterialPageRoute<String>(
        builder: (_) => const _ScannerPage(),
      ),
    );
    if (code != null && mounted) {
      await handleBarcodeResult(code);
    }
  }

  // ── Submission ─────────────────────────────────────────────────────────────

  /// Build a [FoodLogEntry] from the current form state.
  ///
  /// Macros: populated when the field has a parseable number — null otherwise
  /// (never fabricated 0). Tier: exact when ANY macro is filled OR from
  /// barcode; estimate when [isEstimate] is true OR no macros present.
  FoodLogEntry _buildEntry({required bool isEstimate}) {
    final name = _nameCtrl.text.trim();
    final logName = isEstimate ? '~$name' : name;

    final grams = double.tryParse(_gramsCtrl.text.trim());
    final kcal = double.tryParse(_kcalCtrl.text.trim());
    final protein = double.tryParse(_proteinCtrl.text.trim());
    final carbs = double.tryParse(_carbsCtrl.text.trim());
    final fat = double.tryParse(_fatCtrl.text.trim());
    final spend = double.tryParse(_spendCtrl.text.trim());
    final restaurant = _restaurantCtrl.text.trim();

    // Determine tier: estimate when explicitly guessing; exact when macros
    // present or from barcode.
    final hasMacros =
        kcal != null || protein != null || carbs != null || fat != null;
    final tier = isEstimate
        ? AccuracyTier.estimate
        : (hasMacros || _scannedBarcode != null
            ? AccuracyTier.exact
            : AccuracyTier.estimate);

    // Micros from barcode (pass through, excluding main macro keys).
    Map<String, double>? micros;
    final bn = _barcodeNutrition;
    if (bn != null) {
      const macroKeys = {'kcal', 'proteinG', 'carbsG', 'fatG'};
      final m = <String, double>{};
      bn.forEach((k, v) {
        if (!macroKeys.contains(k) && v != null) m[k] = v;
      });
      if (m.isNotEmpty) micros = m;
    }

    return FoodLogEntry(
      id: 'food-${DateTime.now().microsecondsSinceEpoch}',
      name: logName,
      at: DateTime.now(),
      kcal: kcal,
      proteinG: protein,
      carbsG: carbs,
      fatG: fat,
      micros: micros,
      grams: grams,
      tier: tier,
      ateOut: _ateOut,
      restaurant: _ateOut && restaurant.isNotEmpty ? restaurant : null,
      spendGbp: _ateOut ? spend : null,
      barcode: _scannedBarcode,
      source: _scannedBarcode != null ? 'barcode' : 'manual',
    );
  }

  Future<void> _log() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) return;

    final entry = _buildEntry(isEstimate: false);

    // Eat-in cross-link: when the user attached pantry ingredients to an In
    // (home) meal, deduct them from the pantry via EatInService BEFORE logging
    // the food entry. Deduction is offline-safe (the service queues) — a queued
    // write is success, not failure. Any shortfall is surfaced honestly below;
    // it never blocks the log. Out meals never touch the pantry.
    EatInOutcome? outcome;
    if (!_ateOut && _ingredients.isNotEmpty) {
      final meal = MealComposition(
        id: 'meal-${DateTime.now().microsecondsSinceEpoch}',
        name: name,
        ingredients: [
          for (final c in _ingredients)
            Ingredient(pantryItemId: c.item.id, grams: c.grams),
        ],
      );
      // The food log MUST always land; the pantry deduction is best-effort.
      // If the deduction ever throws, we swallow it here and still log the meal
      // (with no eat-in note) rather than silently dropping the food entry.
      try {
        outcome = await _eatIn.eatMeal(meal);
      } catch (_) {
        outcome = null;
      }
    }

    await _repo.add(entry);
    _resetForm();
    await _reloadLog();
    if (outcome != null) _surfaceEatInOutcome(outcome);
  }

  /// Show a calm, TRUTHFUL note after an eat-in deduction: confirm the log and,
  /// if the pantry couldn't fully cover the meal, say so honestly (how many
  /// ingredients were short) — never pretend the pantry covered it.
  void _surfaceEatInOutcome(EatInOutcome outcome) {
    if (!mounted) return;
    final shortCount = outcome.shortfallByItemId.length;
    final message = outcome.hadShortfall
        ? (shortCount == 1
            ? 'Logged — but you were short on 1 ingredient.'
            : 'Logged — but you were short on $shortCount ingredients.')
        : 'Logged — pantry updated.';
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        key: const Key('nutrition-eatin-snackbar'),
        content: Text(message),
      ),
    );
  }

  Future<void> _guess() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) return;

    final entry = _buildEntry(isEstimate: true);
    await _repo.add(entry);
    _resetForm();
    await _reloadLog();
  }

  void _resetForm() {
    setState(() {
      _nameCtrl.clear();
      _gramsCtrl.clear();
      _kcalCtrl.clear();
      _proteinCtrl.clear();
      _carbsCtrl.clear();
      _fatCtrl.clear();
      _restaurantCtrl.clear();
      _spendCtrl.clear();
      _scannedBarcode = null;
      _barcodeNutrition = null;
      _ingredients.clear();
    });
  }

  // ── Eat-in: pantry ingredient picker ─────────────────────────────────────────

  /// Open the pantry-ingredient picker: choose a pantry item + grams to attach
  /// to this home meal. Adds to [_ingredients]; on Log the meal deducts them.
  Future<void> _addIngredient() async {
    final items = await _pantryRepo.all();
    if (!mounted) return;
    final chosen = await showDialog<_ChosenIngredient>(
      context: context,
      builder: (_) => _IngredientPickerDialog(items: items),
    );
    if (chosen != null) {
      setState(() => _ingredients.add(chosen));
    }
  }

  void _removeIngredient(_ChosenIngredient c) {
    setState(() => _ingredients.remove(c));
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Scaffold(
      key: const Key('nutrition-page'),
      backgroundColor: colors.canvas,
      appBar: AppBar(
        backgroundColor: colors.canvas,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        title: Text(
          'Log Food',
          style: text.titleLarge?.copyWith(color: colors.textPrimary),
        ),
      ),
      body: _loading
          ? const Center(child: SizedBox.shrink())
          : ListView(
              padding: AppSpacing.pagePadding,
              children: [
                _buildInOutToggle(),
                AppSpacing.gapV5,
                _buildForm(),
                // Eat-in cross-link — only for In (home) meals. Optional: a meal
                // logs fine with no ingredients (the existing path is unchanged).
                if (!_ateOut) ...[
                  AppSpacing.gapV5,
                  _buildEatInSection(),
                ],
                AppSpacing.gapV5,
                _buildButtons(),
                AppSpacing.gapV8,
                _buildTodayLog(),
              ],
            ),
    );
  }

  // ── In/Out toggle ──────────────────────────────────────────────────────────

  Widget _buildInOutToggle() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Row(
      children: [
        _ToggleChip(
          key: const Key('nutrition-toggle-in'),
          label: 'In (home)',
          selected: !_ateOut,
          onTap: () => setState(() => _ateOut = false),
          colors: colors,
          text: text,
        ),
        AppSpacing.gapH2,
        _ToggleChip(
          key: const Key('nutrition-toggle-out'),
          label: 'Out (restaurant)',
          selected: _ateOut,
          onTap: () => setState(() => _ateOut = true),
          colors: colors,
          text: text,
        ),
      ],
    );
  }

  // ── Form fields ────────────────────────────────────────────────────────────

  Widget _buildForm() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return StatCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Barcode button — opens real scanner on device, never in tests.
          // The Semantics tooltip surfaces the action name to screen readers
          // when focus is on this button.
          Semantics(
            button: true,
            label: _scannedBarcode != null
                ? 'Scanned barcode: $_scannedBarcode'
                : 'Scan barcode',
            child: OutlinedButton.icon(
              key: const Key('nutrition-scan-btn'),
              onPressed: _openScanner,
              icon: Icon(Icons.qr_code_scanner,
                  color: colors.primaryStrong, size: 18),
              label: Text(
                _scannedBarcode != null
                    ? 'Scanned: $_scannedBarcode'
                    : 'Scan barcode',
                style: text.labelMedium?.copyWith(color: colors.primaryStrong),
              ),
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: colors.hairline),
                shape: AppShape.buttonBorder,
                // 48 logical-px minimum height — accessibility touch target.
                minimumSize: const Size(0, 48),
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.space4,
                  vertical: AppSpacing.space2,
                ),
              ),
            ),
          ),
          AppSpacing.gapV4,

          // Name (required)
          _FormField(
            fieldKey: const Key('nutrition-name'),
            controller: _nameCtrl,
            label: 'Food name *',
            keyboardType: TextInputType.text,
            textCapitalization: TextCapitalization.sentences,
            colors: colors,
            text: text,
          ),
          AppSpacing.gapV3,

          // Grams / ml
          _FormField(
            fieldKey: const Key('nutrition-grams'),
            controller: _gramsCtrl,
            label: 'Amount (g or ml)',
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            colors: colors,
            text: text,
          ),
          AppSpacing.gapV3,

          // Macros — all optional; absent stays null (honest)
          _MacroRow(
            kcalKey: const Key('nutrition-kcal'),
            proteinKey: const Key('nutrition-protein'),
            carbsKey: const Key('nutrition-carbs'),
            fatKey: const Key('nutrition-fat'),
            kcalCtrl: _kcalCtrl,
            proteinCtrl: _proteinCtrl,
            carbsCtrl: _carbsCtrl,
            fatCtrl: _fatCtrl,
            colors: colors,
            text: text,
          ),

          // Out-mode fields (only shown when Out is selected)
          if (_ateOut) ...[
            AppSpacing.gapV3,
            _FormField(
              fieldKey: const Key('nutrition-restaurant'),
              controller: _restaurantCtrl,
              label: 'Restaurant / place',
              keyboardType: TextInputType.text,
              textCapitalization: TextCapitalization.words,
              colors: colors,
              text: text,
            ),
            AppSpacing.gapV3,
            _FormField(
              fieldKey: const Key('nutrition-spend'),
              controller: _spendCtrl,
              label: '£ Spend (optional)',
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              prefixText: '£',
              colors: colors,
              text: text,
            ),
          ],
        ],
      ),
    );
  }

  // ── Eat-in from pantry section ───────────────────────────────────────────────

  /// The optional "Eat in from pantry" affordance (In mode only): attach pantry
  /// ingredients so logging the meal deducts them from stock. Chosen ingredients
  /// show as removable rows; empty by default so the plain log path is untouched.
  Widget _buildEatInSection() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return StatCard(
      key: const Key('nutrition-eatin-section'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Eat in from pantry',
                  style: text.titleSmall?.copyWith(color: colors.textPrimary),
                ),
              ),
              TextButton.icon(
                key: const Key('nutrition-add-ingredient'),
                onPressed: _addIngredient,
                icon: Icon(Icons.add, size: 18, color: colors.primaryStrong),
                label: Text(
                  'Add',
                  style: text.labelMedium?.copyWith(color: colors.primaryStrong),
                ),
              ),
            ],
          ),
          if (_ingredients.isEmpty)
            Text(
              'Optional — attach pantry items to deduct stock when you log.',
              style: text.bodySmall?.copyWith(color: colors.textSecondary),
            )
          else
            ..._ingredients.map(
              (c) => Padding(
                key: Key('nutrition-ingredient-${c.item.id}'),
                padding: const EdgeInsets.only(top: AppSpacing.space2),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        c.item.name,
                        style: text.bodyMedium
                            ?.copyWith(color: colors.textPrimary),
                      ),
                    ),
                    Text(
                      '${_fmtGrams(c.grams)} g',
                      style: text.bodyMedium
                          ?.copyWith(color: colors.textSecondary),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      tooltip: 'Remove',
                      onPressed: () => _removeIngredient(c),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  static String _fmtGrams(double g) =>
      g == g.roundToDouble() ? g.round().toString() : g.toStringAsFixed(1);

  // ── Log / Guess buttons ────────────────────────────────────────────────────

  Widget _buildButtons() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Row(
      children: [
        Expanded(
          child: FilledButton(
            key: const Key('nutrition-log-btn'),
            onPressed: _log,
            style: FilledButton.styleFrom(
              backgroundColor: colors.primary,
              foregroundColor: colors.textPrimary,
              shape: AppShape.buttonBorder,
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.space3),
              textStyle: text.labelLarge,
            ),
            child: const Text('Log'),
          ),
        ),
        AppSpacing.gapH3,
        Expanded(
          child: OutlinedButton(
            key: const Key('nutrition-guess-btn'),
            onPressed: _guess,
            style: OutlinedButton.styleFrom(
              foregroundColor: colors.textSecondary,
              side: BorderSide(color: colors.hairline),
              shape: AppShape.buttonBorder,
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.space3),
              textStyle: text.labelLarge,
            ),
            child: const Text('Guess (~)'),
          ),
        ),
      ],
    );
  }

  // ── Today's log ────────────────────────────────────────────────────────────

  Widget _buildTodayLog() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    if (_todayLog.isEmpty) {
      return Text(
        'Nothing logged today.',
        style: text.bodyMedium?.copyWith(color: colors.textSecondary),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader(title: "TODAY'S LOG"),
        StatCard(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.cardPadding,
            vertical: AppSpacing.space3,
          ),
          child: Column(
            children: _todayLog.asMap().entries.map((entry) {
              return _LogEntryTile(
                entry: entry.value,
                isLast: entry.key == _todayLog.length - 1,
              );
            }).toList(),
          ),
        ),
      ],
    );
  }
}

// ── _ToggleChip ───────────────────────────────────────────────────────────────

class _ToggleChip extends StatelessWidget {
  const _ToggleChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    required this.colors,
    required this.text,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final AppColors colors;
  final TextTheme text;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: AppMotion.fast,
        curve: AppMotion.standard,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.space4,
          vertical: AppSpacing.space2,
        ),
        decoration: BoxDecoration(
          color: selected ? colors.primary : colors.surface,
          borderRadius: AppShape.chip,
          border: Border.all(
            color: selected ? colors.primary : colors.hairline,
          ),
        ),
        child: Text(
          label,
          style: text.labelMedium?.copyWith(
            color: selected ? colors.textPrimary : colors.textSecondary,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
      ),
    );
  }
}

// ── _FormField ────────────────────────────────────────────────────────────────

/// A single luxury-styled input field for the nutrition capture form.
class _FormField extends StatelessWidget {
  const _FormField({
    required this.fieldKey,
    required this.controller,
    required this.label,
    required this.keyboardType,
    required this.colors,
    required this.text,
    this.textCapitalization = TextCapitalization.none,
    this.prefixText,
  });

  final Key fieldKey;
  final TextEditingController controller;
  final String label;
  final TextInputType keyboardType;
  final AppColors colors;
  final TextTheme text;
  final TextCapitalization textCapitalization;
  final String? prefixText;

  @override
  Widget build(BuildContext context) {
    return TextField(
      key: fieldKey,
      controller: controller,
      keyboardType: keyboardType,
      textCapitalization: textCapitalization,
      style: text.bodyLarge?.copyWith(color: colors.textPrimary),
      decoration: InputDecoration(
        labelText: label,
        prefixText: prefixText,
        labelStyle: text.bodySmall?.copyWith(color: colors.textSecondary),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppShape.field,
          borderSide: BorderSide(color: colors.hairline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppShape.field,
          borderSide: BorderSide(color: colors.primary, width: 1.5),
        ),
        filled: true,
        fillColor: colors.canvas,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.space4,
          vertical: AppSpacing.space3,
        ),
      ),
    );
  }
}

// ── _MacroRow ─────────────────────────────────────────────────────────────────

class _MacroRow extends StatelessWidget {
  const _MacroRow({
    required this.kcalKey,
    required this.proteinKey,
    required this.carbsKey,
    required this.fatKey,
    required this.kcalCtrl,
    required this.proteinCtrl,
    required this.carbsCtrl,
    required this.fatCtrl,
    required this.colors,
    required this.text,
  });

  final Key kcalKey;
  final Key proteinKey;
  final Key carbsKey;
  final Key fatKey;
  final TextEditingController kcalCtrl;
  final TextEditingController proteinCtrl;
  final TextEditingController carbsCtrl;
  final TextEditingController fatCtrl;
  final AppColors colors;
  final TextTheme text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: _MacroField(fieldKey: kcalKey, controller: kcalCtrl, label: 'kcal', colors: colors, text: text)),
        AppSpacing.gapH2,
        Expanded(child: _MacroField(fieldKey: proteinKey, controller: proteinCtrl, label: 'Protein g', colors: colors, text: text)),
        AppSpacing.gapH2,
        Expanded(child: _MacroField(fieldKey: carbsKey, controller: carbsCtrl, label: 'Carbs g', colors: colors, text: text)),
        AppSpacing.gapH2,
        Expanded(child: _MacroField(fieldKey: fatKey, controller: fatCtrl, label: 'Fat g', colors: colors, text: text)),
      ],
    );
  }
}

class _MacroField extends StatelessWidget {
  const _MacroField({
    required this.fieldKey,
    required this.controller,
    required this.label,
    required this.colors,
    required this.text,
  });

  final Key fieldKey;
  final TextEditingController controller;
  final String label;
  final AppColors colors;
  final TextTheme text;

  @override
  Widget build(BuildContext context) {
    return TextField(
      key: fieldKey,
      controller: controller,
      style: text.bodyMedium?.copyWith(color: colors.textPrimary),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: text.labelSmall?.copyWith(color: colors.textSecondary),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppShape.field,
          borderSide: BorderSide(color: colors.hairline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppShape.field,
          borderSide: BorderSide(color: colors.primary, width: 1.5),
        ),
        filled: true,
        fillColor: colors.canvas,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.space2,
          vertical: AppSpacing.space2,
        ),
      ),
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
    );
  }
}

// ── _LogEntryTile ─────────────────────────────────────────────────────────────

class _LogEntryTile extends StatelessWidget {
  const _LogEntryTile({required this.entry, this.isLast = false});

  final FoodLogEntry entry;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final isEstimate = entry.tier == AccuracyTier.estimate;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.space3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            entry.name,
                            style: text.bodyMedium
                                ?.copyWith(color: colors.textPrimary),
                          ),
                        ),
                        if (isEstimate)
                          Padding(
                            padding: const EdgeInsets.only(left: AppSpacing.space1),
                            child: Text(
                              '~',
                              style: text.labelMedium?.copyWith(
                                color: colors.primaryStrong,
                              ),
                            ),
                          ),
                      ],
                    ),
                    AppSpacing.gapV1,
                    Text(
                      '${showOrDash(entry.kcal)} kcal  '
                      'P:${showOrDash(entry.proteinG)}  '
                      'C:${showOrDash(entry.carbsG)}  '
                      'F:${showOrDash(entry.fatG)}',
                      style: text.bodySmall,
                    ),
                  ],
                ),
              ),
              if (entry.ateOut)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.tightGap),
                  child: Icon(
                    Icons.restaurant,
                    size: 16,
                    color: colors.textSecondary,
                  ),
                ),
            ],
          ),
        ),
        if (!isLast)
          Divider(height: 1, thickness: 1, color: colors.hairline),
      ],
    );
  }
}

// ── Eat-in ingredient picker ──────────────────────────────────────────────────

/// A pantry item chosen as a meal ingredient, plus the grams to deduct.
class _ChosenIngredient {
  const _ChosenIngredient({required this.item, required this.grams});

  final PantryItem item;
  final double grams;
}

/// Picks ONE pantry item + grams to attach to a home meal. Returns a
/// [_ChosenIngredient], or null if cancelled. Honest empty state when the
/// pantry has no items (never fabricates a stock list).
class _IngredientPickerDialog extends StatefulWidget {
  const _IngredientPickerDialog({required this.items});

  final List<PantryItem> items;

  @override
  State<_IngredientPickerDialog> createState() =>
      _IngredientPickerDialogState();
}

class _IngredientPickerDialogState extends State<_IngredientPickerDialog> {
  PantryItem? _selected;
  final _gramsCtrl = TextEditingController();

  @override
  void dispose() {
    _gramsCtrl.dispose();
    super.dispose();
  }

  void _confirm() {
    final item = _selected;
    final grams = double.tryParse(_gramsCtrl.text.trim());
    if (item == null || grams == null || grams <= 0) return;
    Navigator.of(context).pop(_ChosenIngredient(item: item, grams: grams));
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add pantry ingredient'),
      content: widget.items.isEmpty
          ? const Text('No pantry items yet. Add some on the Food page first.')
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<PantryItem>(
                  key: const Key('nutrition-ingredient-item'),
                  initialValue: _selected,
                  decoration: const InputDecoration(labelText: 'Pantry item'),
                  items: widget.items
                      .map((i) => DropdownMenuItem(
                            value: i,
                            child: Text(i.name),
                          ))
                      .toList(),
                  onChanged: (i) => setState(() => _selected = i),
                ),
                const SizedBox(height: AppSpacing.space2),
                TextField(
                  key: const Key('nutrition-ingredient-grams'),
                  controller: _gramsCtrl,
                  decoration: const InputDecoration(labelText: 'Grams'),
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                ),
              ],
            ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        if (widget.items.isNotEmpty)
          FilledButton(
            key: const Key('nutrition-ingredient-confirm'),
            onPressed: _confirm,
            child: const Text('Add'),
          ),
      ],
    );
  }
}

// ── _ScannerPage ──────────────────────────────────────────────────────────────
//
// Fullscreen page that activates the camera for barcode scanning.
// Only pushed from [NutritionPageState._openScanner] on real devices.
// Tests never push this route, so MobileScanner is never instantiated in tests.

class _ScannerPage extends StatefulWidget {
  const _ScannerPage();

  @override
  State<_ScannerPage> createState() => _ScannerPageState();
}

class _ScannerPageState extends State<_ScannerPage> {
  bool _detected = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan barcode')),
      body: MobileScanner(
        onDetect: (capture) {
          if (_detected) return;
          final raw = capture.barcodes.firstOrNull?.rawValue;
          if (raw != null && mounted) {
            setState(() => _detected = true);
            Navigator.of(context).pop(raw);
          }
        },
      ),
    );
  }
}
