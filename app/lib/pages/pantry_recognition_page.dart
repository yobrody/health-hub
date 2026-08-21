// Pantry recognition confirm screen (R-2).
//
// After AI vision returns [RecognizedItem] SUGGESTIONS, this screen shows them
// as an EDITABLE, CONFIRMABLE list. Honesty is load-bearing:
//  • Nothing is saved until the user taps Confirm. Recognized items are
//    suggestions, never auto-populated pantry facts.
//  • Each row shows its confidence HONESTLY (a "likely"/"unsure" chip + %),
//    with low-confidence rows visibly flagged — never hidden.
//  • qty/unit stay blank when the model didn't clearly see them; a blank amount
//    persists as null (never a fabricated 0).
//  • The user can edit any field, REMOVE a row, and only the remaining
//    (edited) rows are saved to the pantry via [PantryRepo.add] (offline-queued).
//  • An empty recognition result shows an honest fallback ("Couldn't identify
//    items — add manually"), and saves nothing.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../design_system/colors.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/spacing.dart';
import '../pantry/pantry_item.dart';
import '../pantry/pantry_repo.dart';
import '../pantry/recognition/pantry_recognition.dart';

/// The confidence band an item falls into — drives the honest label + tone.
enum _ConfidenceBand { likely, maybe, unsure }

_ConfidenceBand _bandFor(double confidence) {
  if (confidence >= 0.75) return _ConfidenceBand.likely;
  if (confidence >= 0.5) return _ConfidenceBand.maybe;
  return _ConfidenceBand.unsure;
}

String _bandLabel(_ConfidenceBand band) {
  switch (band) {
    case _ConfidenceBand.likely:
      return 'Likely';
    case _ConfidenceBand.maybe:
      return 'Maybe';
    case _ConfidenceBand.unsure:
      return 'Unsure';
  }
}

String _zoneName(PantryZone zone) {
  switch (zone) {
    case PantryZone.fridge:
      return 'Fridge';
    case PantryZone.pantry:
      return 'Pantry';
    case PantryZone.freezer:
      return 'Freezer';
    case PantryZone.condiments:
      return 'Condiments';
  }
}

/// A mutable draft the user edits before confirming. Seeded from a
/// [RecognizedItem]; blank qty/unit stay blank (→ null on save).
class _DraftRow {
  _DraftRow.fromRecognized(RecognizedItem item)
      : nameCtrl = TextEditingController(text: item.name),
        qtyCtrl = TextEditingController(
            text: item.qtyGuess == null ? '' : _trimNum(item.qtyGuess!)),
        unitCtrl = TextEditingController(text: item.unitGuess ?? ''),
        zone = item.zoneGuess,
        confidence = item.confidence;

  final TextEditingController nameCtrl;
  final TextEditingController qtyCtrl;
  final TextEditingController unitCtrl;
  PantryZone zone;
  final double confidence;

  static String _trimNum(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toString();

  void dispose() {
    nameCtrl.dispose();
    qtyCtrl.dispose();
    unitCtrl.dispose();
  }
}

/// The confirm-before-save screen. Push it with a [RecognitionResult].
class PantryRecognitionPage extends ConsumerStatefulWidget {
  const PantryRecognitionPage({super.key, required this.result});

  /// The suggestions returned by recognition. May be empty (honest fallback).
  final RecognitionResult result;

  @override
  ConsumerState<PantryRecognitionPage> createState() =>
      _PantryRecognitionPageState();
}

class _PantryRecognitionPageState
    extends ConsumerState<PantryRecognitionPage> {
  late List<_DraftRow> _rows;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _rows = widget.result.items
        .map(_DraftRow.fromRecognized)
        .toList(growable: true);
  }

  @override
  void dispose() {
    for (final r in _rows) {
      r.dispose();
    }
    super.dispose();
  }

  PantryRepo get _repo => ref.read(pantryRepoProvider);

  void _remove(int index) {
    setState(() {
      _rows.removeAt(index).dispose();
    });
  }

  /// Save exactly the remaining (edited) rows to the pantry as real items.
  /// Rows the user removed are NOT saved. Blank qty/unit persist as null.
  Future<void> _confirm() async {
    if (_saving) return;
    setState(() => _saving = true);

    var seq = 0;
    for (final r in _rows) {
      final name = r.nameCtrl.text.trim();
      if (name.isEmpty) continue; // never save a nameless row

      final qtyText = r.qtyCtrl.text.trim();
      final unitText = r.unitCtrl.text.trim();

      final item = PantryItem(
        // A stable-ish unique id; seq guards same-microsecond collisions.
        id: 'scan-${DateTime.now().microsecondsSinceEpoch}-${seq++}',
        name: name,
        zone: r.zone,
        qty: qtyText.isEmpty ? null : double.tryParse(qtyText),
        unit: unitText.isEmpty ? null : unitText,
        source: 'scan',
      );
      await _repo.add(item);
    }

    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    return Scaffold(
      key: const Key('pantry-recognition-page'),
      backgroundColor: colors.canvas,
      appBar: AppBar(
        title: const Text('Confirm items'),
        backgroundColor: colors.canvas,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
      ),
      body: _rows.isEmpty ? _buildEmpty() : _buildList(),
    );
  }

  // Honest fallback: recognition found nothing (or the user removed everything).
  Widget _buildEmpty() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Center(
      child: SingleChildScrollView(
        padding: AppSpacing.pagePadding,
        child: StatCard(
          key: const Key('recognition-empty'),
          warm: true,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.search_off_outlined,
                  size: 40, color: colors.primaryStrong),
              AppSpacing.gapV4,
              Text('Couldn\'t identify items', style: text.titleMedium),
              AppSpacing.gapV2,
              Text(
                'The photos didn\'t clearly show any items we could recognize. '
                'Add them manually instead — nothing was saved.',
                style: text.bodyMedium?.copyWith(color: colors.textSecondary),
              ),
              AppSpacing.gapV5,
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  key: const Key('recognition-empty-back'),
                  onPressed: () => Navigator.of(context).pop(false),
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Add manually'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildList() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: AppSpacing.pagePadding,
            children: [
              Text(
                'We spotted these items — nothing is saved yet. Edit, remove, '
                'or confirm. Low-confidence guesses are flagged.',
                style: text.bodyMedium?.copyWith(color: colors.textSecondary),
              ),
              AppSpacing.gapV5,
              const SectionHeader(title: 'Recognized items'),
              for (var i = 0; i < _rows.length; i++) ...[
                _RecognizedRow(
                  key: Key('recognition-item-$i'),
                  index: i,
                  row: _rows[i],
                  onRemove: () => _remove(i),
                  onZoneChanged: (z) => setState(() => _rows[i].zone = z),
                ),
                AppSpacing.gapV4,
              ],
            ],
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.gutter,
              AppSpacing.space2,
              AppSpacing.gutter,
              AppSpacing.space4,
            ),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton(
                key: const Key('recognition-confirm-btn'),
                onPressed: _saving ? null : _confirm,
                child: Text(_saving ? 'Saving…' : 'Confirm & add to pantry'),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

// ── A single editable recognized row ─────────────────────────────────────────

class _RecognizedRow extends StatelessWidget {
  const _RecognizedRow({
    super.key,
    required this.index,
    required this.row,
    required this.onRemove,
    required this.onZoneChanged,
  });

  final int index;
  final _DraftRow row;
  final VoidCallback onRemove;
  final ValueChanged<PantryZone> onZoneChanged;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    return StatCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: _ConfidenceChip(confidence: row.confidence)),
              IconButton(
                key: Key('recognition-remove-$index'),
                icon: Icon(Icons.close, size: 20, color: colors.textSecondary),
                onPressed: onRemove,
                tooltip: 'Remove',
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
          AppSpacing.gapV2,
          // Name (editable)
          TextField(
            key: Key('recognition-name-$index'),
            controller: row.nameCtrl,
            decoration: const InputDecoration(labelText: 'Name'),
            textCapitalization: TextCapitalization.sentences,
          ),
          AppSpacing.gapV3,
          // Zone (editable)
          DropdownButtonFormField<PantryZone>(
            key: Key('recognition-zone-$index'),
            initialValue: row.zone,
            decoration: const InputDecoration(labelText: 'Zone'),
            items: PantryZone.values
                .map((z) => DropdownMenuItem(
                      value: z,
                      child: Text(_zoneName(z)),
                    ))
                .toList(),
            onChanged: (z) {
              if (z != null) onZoneChanged(z);
            },
          ),
          AppSpacing.gapV3,
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Qty (editable, blank allowed → null)
              Expanded(
                child: TextField(
                  key: Key('recognition-qty-$index'),
                  controller: row.qtyCtrl,
                  decoration:
                      const InputDecoration(labelText: 'Qty (optional)'),
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                ),
              ),
              AppSpacing.gapH3,
              // Unit (editable, blank allowed → null)
              Expanded(
                child: TextField(
                  key: Key('recognition-unit-$index'),
                  controller: row.unitCtrl,
                  decoration:
                      const InputDecoration(labelText: 'Unit (optional)'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ── Honest confidence chip ───────────────────────────────────────────────────

class _ConfidenceChip extends StatelessWidget {
  const _ConfidenceChip({required this.confidence});

  final double confidence;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final band = _bandFor(confidence);
    final pct = (confidence * 100).round();

    final Color tone;
    switch (band) {
      case _ConfidenceBand.likely:
        tone = colors.accent;
      case _ConfidenceBand.maybe:
        tone = Colors.orange;
      case _ConfidenceBand.unsure:
        tone = Colors.red;
    }

    final label = '${_bandLabel(band)} · $pct%';

    return Semantics(
      // Plain-text so screen readers announce the confidence honestly.
      label: 'Confidence: $label',
      child: Container(
        key: Key('recognition-confidence-${band.name}'),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.space3,
          vertical: AppSpacing.space1,
        ),
        decoration: BoxDecoration(
          color: tone.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: tone.withValues(alpha: 0.4)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              band == _ConfidenceBand.unsure
                  ? Icons.help_outline
                  : Icons.auto_awesome_outlined,
              size: 14,
              color: tone,
            ),
            AppSpacing.gapH1,
            Text(
              label,
              style: text.labelSmall?.copyWith(
                color: colors.textPrimary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
