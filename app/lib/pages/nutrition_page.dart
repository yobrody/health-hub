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
import '../nutrition/food_log_entry.dart';
import '../nutrition/nutrition_repo.dart';
import '../nutrition/off_client.dart';
import '../nutrition/packaged_food_model.dart';
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

  bool _loading = false;

  // ── Providers ──────────────────────────────────────────────────────────────

  NutritionRepo get _repo => ref.read(nutritionRepoProvider);
  OffClient get _offClient => ref.read(offClientProvider);

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
    await _repo.add(entry);
    _resetForm();
    await _reloadLog();
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
    });
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: const Key('nutrition-page'),
      appBar: AppBar(
        title: const Text('Log Food'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _buildInOutToggle(),
                const SizedBox(height: 12),
                _buildForm(),
                const SizedBox(height: 12),
                _buildButtons(),
                const Divider(height: 32),
                _buildTodayLog(),
              ],
            ),
    );
  }

  // ── In/Out toggle ──────────────────────────────────────────────────────────

  Widget _buildInOutToggle() {
    return Row(
      children: [
        _ToggleChip(
          key: const Key('nutrition-toggle-in'),
          label: 'In (home)',
          selected: !_ateOut,
          onTap: () => setState(() => _ateOut = false),
        ),
        const SizedBox(width: 8),
        _ToggleChip(
          key: const Key('nutrition-toggle-out'),
          label: 'Out (restaurant)',
          selected: _ateOut,
          onTap: () => setState(() => _ateOut = true),
        ),
      ],
    );
  }

  // ── Form fields ────────────────────────────────────────────────────────────

  Widget _buildForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Barcode button — opens real scanner on device, never in tests.
        OutlinedButton.icon(
          key: const Key('nutrition-scan-btn'),
          onPressed: _openScanner,
          icon: const Icon(Icons.qr_code_scanner),
          label: Text(_scannedBarcode != null
              ? 'Scanned: $_scannedBarcode'
              : 'Scan barcode'),
        ),
        const SizedBox(height: 12),

        // Name (required)
        TextField(
          key: const Key('nutrition-name'),
          controller: _nameCtrl,
          decoration: const InputDecoration(
            labelText: 'Food name *',
            border: OutlineInputBorder(),
          ),
          textCapitalization: TextCapitalization.sentences,
        ),
        const SizedBox(height: 8),

        // Grams / ml
        TextField(
          key: const Key('nutrition-grams'),
          controller: _gramsCtrl,
          decoration: const InputDecoration(
            labelText: 'Amount (g or ml)',
            border: OutlineInputBorder(),
          ),
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
        ),
        const SizedBox(height: 8),

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
        ),
        const SizedBox(height: 8),

        // Out-mode fields (only shown when Out is selected)
        if (_ateOut) ...[
          TextField(
            key: const Key('nutrition-restaurant'),
            controller: _restaurantCtrl,
            decoration: const InputDecoration(
              labelText: 'Restaurant / place',
              border: OutlineInputBorder(),
            ),
            textCapitalization: TextCapitalization.words,
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('nutrition-spend'),
            controller: _spendCtrl,
            decoration: const InputDecoration(
              labelText: '£ Spend (optional)',
              border: OutlineInputBorder(),
              prefixText: '£',
            ),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
          ),
        ],
      ],
    );
  }

  // ── Log / Guess buttons ────────────────────────────────────────────────────

  Widget _buildButtons() {
    return Row(
      children: [
        Expanded(
          child: FilledButton(
            key: const Key('nutrition-log-btn'),
            onPressed: _log,
            child: const Text('Log'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: OutlinedButton(
            key: const Key('nutrition-guess-btn'),
            onPressed: _guess,
            child: const Text('Guess (~)'),
          ),
        ),
      ],
    );
  }

  // ── Today's log ────────────────────────────────────────────────────────────

  Widget _buildTodayLog() {
    if (_todayLog.isEmpty) {
      return const Text(
        "Nothing logged today.",
        style: TextStyle(color: Colors.grey),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          "Today's log",
          style: Theme.of(context)
              .textTheme
              .titleSmall
              ?.copyWith(fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        ..._todayLog.map((e) => _LogEntryTile(entry: e)),
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
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: selected
              ? Theme.of(context).colorScheme.primary
              : Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected
                ? Theme.of(context).colorScheme.onPrimary
                : Theme.of(context).colorScheme.onSurface,
            fontWeight: FontWeight.w500,
          ),
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
  });

  final Key kcalKey;
  final Key proteinKey;
  final Key carbsKey;
  final Key fatKey;
  final TextEditingController kcalCtrl;
  final TextEditingController proteinCtrl;
  final TextEditingController carbsCtrl;
  final TextEditingController fatCtrl;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _MacroField(
              fieldKey: kcalKey, controller: kcalCtrl, label: 'kcal'),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: _MacroField(
              fieldKey: proteinKey,
              controller: proteinCtrl,
              label: 'Protein g'),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: _MacroField(
              fieldKey: carbsKey, controller: carbsCtrl, label: 'Carbs g'),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: _MacroField(
              fieldKey: fatKey, controller: fatCtrl, label: 'Fat g'),
        ),
      ],
    );
  }
}

class _MacroField extends StatelessWidget {
  const _MacroField({
    required this.fieldKey,
    required this.controller,
    required this.label,
  });

  final Key fieldKey;
  final TextEditingController controller;
  final String label;

  @override
  Widget build(BuildContext context) {
    return TextField(
      key: fieldKey,
      controller: controller,
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
        contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      ),
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
    );
  }
}

// ── _LogEntryTile ─────────────────────────────────────────────────────────────

class _LogEntryTile extends StatelessWidget {
  const _LogEntryTile({required this.entry});

  final FoodLogEntry entry;

  @override
  Widget build(BuildContext context) {
    final isEstimate = entry.tier == AccuracyTier.estimate;

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        entry.name,
                        style: const TextStyle(fontWeight: FontWeight.w500),
                      ),
                      if (isEstimate)
                        Padding(
                          padding: const EdgeInsets.only(left: 4),
                          child: Text(
                            '~',
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.primary,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                    ],
                  ),
                  Text(
                    '${showOrDash(entry.kcal)} kcal  '
                    'P:${showOrDash(entry.proteinG)}  '
                    'C:${showOrDash(entry.carbsG)}  '
                    'F:${showOrDash(entry.fatG)}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            if (entry.ateOut)
              Icon(Icons.restaurant,
                  size: 16,
                  color: Theme.of(context).colorScheme.tertiary),
          ],
        ),
      ),
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
