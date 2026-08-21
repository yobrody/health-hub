// Fridge / Pantry page (P1-T3).
//
// Shows all pantry items grouped by zone (fridge / pantry / freezer /
// condiments). Each row has a freshness dot + name + qty display. Supports
// add (FAB → dialog form), edit (tap row → pre-filled form), and delete
// (trailing icon button).
//
// Honesty rules:
//  • All null fields render via [showOrDash] → `—`; never shown as `0` / fake.
//  • An item with no expiry shows `unknown` (grey dot), not `fresh` (green).
//  • All mutations flow through [PantryRepo] via [pantryRepoProvider].

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../design_system/colors.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/spacing.dart';
import '../pantry/pantry_item.dart';
import '../pantry/pantry_repo.dart';
import '../pantry/shelf_life.dart';
import '../profile/profile_model.dart'; // showOrDash

// ── Zone display helpers ─────────────────────────────────────────────────────

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

// All zones in display order.
const _zoneOrder = [
  PantryZone.fridge,
  PantryZone.pantry,
  PantryZone.freezer,
  PantryZone.condiments,
];

// ── Freshness dot ────────────────────────────────────────────────────────────

/// Coloured dot indicating [freshness]. Key is `freshness-<name>`.
///
/// Colour alone is not accessible to all users. The dot is paired with a
/// [Semantics] label that surfaces the freshness state as plain text so
/// screen readers can announce it (e.g. "Expired") without relying on the
/// colour. The dot itself is purely visual — its decorative [Container] is
/// wrapped, not excluded, so the Key stays discoverable in the semantics tree.
class _FreshnessDot extends StatelessWidget {
  const _FreshnessDot(this.freshness);

  final Freshness freshness;

  String get _semanticsLabel {
    switch (freshness) {
      case Freshness.fresh:
        return 'Fresh';
      case Freshness.useSoon:
        return 'Use soon';
      case Freshness.expired:
        return 'Expired';
      case Freshness.unknown:
        return 'Expiry unknown';
    }
  }

  @override
  Widget build(BuildContext context) {
    final Color color;
    switch (freshness) {
      case Freshness.fresh:
        color = Colors.green;
      case Freshness.useSoon:
        color = Colors.orange;
      case Freshness.expired:
        color = Colors.red;
      case Freshness.unknown:
        color = Colors.grey;
    }
    return Semantics(
      label: _semanticsLabel,
      child: Container(
        key: Key('freshness-${freshness.name}'),
        width: 10,
        height: 10,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
    );
  }
}

// ── FoodPage ─────────────────────────────────────────────────────────────────

class FoodPage extends ConsumerStatefulWidget {
  const FoodPage({super.key});

  @override
  ConsumerState<FoodPage> createState() => _FoodPageState();
}

class _FoodPageState extends ConsumerState<FoodPage> {
  List<PantryItem> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  PantryRepo get _repo => ref.read(pantryRepoProvider);

  Future<void> _reload() async {
    final items = await _repo.all();
    if (!mounted) return;
    setState(() {
      _items = items;
      _loading = false;
    });
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  Future<void> _openAddForm() async {
    final result = await showDialog<PantryItem>(
      context: context,
      builder: (_) => const _ItemFormDialog(),
    );
    if (result != null) {
      await _repo.add(result);
      await _reload();
    }
  }

  Future<void> _openEditForm(PantryItem item) async {
    final result = await showDialog<PantryItem>(
      context: context,
      builder: (_) => _ItemFormDialog(existing: item),
    );
    if (result != null) {
      await _repo.update(result);
      await _reload();
    }
  }

  Future<void> _delete(String id) async {
    await _repo.delete(id);
    await _reload();
  }

  /// The photo-upload path is a STUB in R-1. The real AI vision that recognizes
  /// items from fridge/pantry photos is R-2 — so this is HONEST about that: it
  /// shows a "coming soon" message and NEVER fabricates recognized items. Manual
  /// add remains the real way to populate the pantry today.
  void _uploadPhotosStub() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        key: Key('food-gate-upload-snackbar'),
        content: Text(
          'Photo recognition is coming soon — add items manually for now.',
        ),
      ),
    );
  }

  // ── Detail sheet ───────────────────────────────────────────────────────────

  void _showDetail(PantryItem item) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _DetailSheet(item: item),
    );
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;

    return Scaffold(
      key: const Key('food-page'),
      backgroundColor: colors.canvas,
      appBar: AppBar(
        title: const Text('Fridge & Pantry'),
        backgroundColor: colors.canvas,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
      ),
      floatingActionButton: FloatingActionButton(
        key: const Key('food-add-fab'),
        onPressed: _openAddForm,
        tooltip: 'Add item',
        child: const Icon(Icons.add),
      ),
      body: _loading
          ? const SizedBox.shrink()
          : _buildList(),
    );
  }

  Widget _buildList() {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    if (_items.isEmpty) {
      // First-run gate (R-1) — NON-BLOCKING: the hero invites uploading fridge/
      // freezer/pantry/spice photos (a STUB in R-1 — the real AI recognition is
      // R-2, so it never pretends to recognize anything), but an "Add manually"
      // path always keeps the app usable via the existing add-item flow.
      return Center(
        child: SingleChildScrollView(
          padding: AppSpacing.pagePadding,
          child: StatCard(
            key: const Key('food-gate'),
            warm: true,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.photo_camera_outlined,
                  size: 40,
                  color: colors.primaryStrong,
                ),
                AppSpacing.gapV4,
                Text(
                  'Upload photos of your fridge, freezer, pantry & spices',
                  style: text.titleMedium,
                ),
                AppSpacing.gapV2,
                Text(
                  'We’ll identify what you have and fill your kitchen. '
                  'Prefer to type it in? Add items manually — it works the same.',
                  style:
                      text.bodyMedium?.copyWith(color: colors.textSecondary),
                ),
                AppSpacing.gapV5,
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    key: const Key('food-gate-upload'),
                    onPressed: _uploadPhotosStub,
                    icon: const Icon(Icons.upload_outlined),
                    label: const Text('Upload photos'),
                  ),
                ),
                AppSpacing.gapV2,
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    key: const Key('food-gate-manual'),
                    onPressed: _openAddForm,
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

    final now = DateTime.now();
    final sections = <Widget>[];

    for (final zone in _zoneOrder) {
      final zoneItems = _items.where((i) => i.zone == zone).toList();
      if (zoneItems.isEmpty) continue;

      sections.add(SectionHeader(title: _zoneName(zone)));

      sections.add(
        StatCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              for (var i = 0; i < zoneItems.length; i++) ...[
                if (i > 0)
                  Divider(height: 1, thickness: 1, color: colors.hairline),
                _PantryItemTile(
                  item: zoneItems[i],
                  freshness: freshnessOf(zoneItems[i], now),
                  onTap: () => _showDetail(zoneItems[i]),
                  onEdit: () => _openEditForm(zoneItems[i]),
                  onDelete: () => _delete(zoneItems[i].id),
                ),
              ],
            ],
          ),
        ),
      );

      sections.add(AppSpacing.gapV8);
    }

    return ListView(
      padding: AppSpacing.pagePadding,
      children: sections,
    );
  }
}

// ── _PantryItemTile ───────────────────────────────────────────────────────────

class _PantryItemTile extends StatelessWidget {
  const _PantryItemTile({
    required this.item,
    required this.freshness,
    required this.onTap,
    required this.onEdit,
    required this.onDelete,
  });

  final PantryItem item;
  final Freshness freshness;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    final qtyDisplay = item.qty == null
        ? '—'
        : (item.unit != null ? '${item.qty} ${item.unit}' : '${item.qty}');

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.cardPadding,
          vertical: AppSpacing.space4,
        ),
        child: Row(
          children: [
            _FreshnessDot(freshness),
            AppSpacing.gapH3,
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.name,
                    style: text.bodyLarge?.copyWith(
                      color: colors.textPrimary,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if (qtyDisplay != '—') ...[
                    AppSpacing.gapV1,
                    Text(
                      qtyDisplay,
                      style: text.bodySmall?.copyWith(
                        color: colors.textSecondary,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            IconButton(
              icon: Icon(Icons.edit_outlined,
                  size: 18, color: colors.textSecondary),
              onPressed: onEdit,
              tooltip: 'Edit',
              visualDensity: VisualDensity.compact,
            ),
            IconButton(
              icon: Icon(Icons.delete_outline,
                  size: 18, color: colors.textSecondary),
              onPressed: onDelete,
              tooltip: 'Delete',
              visualDensity: VisualDensity.compact,
            ),
          ],
        ),
      ),
    );
  }
}

// ── Detail sheet ──────────────────────────────────────────────────────────────

class _DetailSheet extends StatelessWidget {
  const _DetailSheet({required this.item});

  final PantryItem item;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final expiry = item.expiry;
    final purchased = item.purchasedAt;
    final lastBought = item.lastBought;

    String fmtDate(DateTime? d) => d == null
        ? '—'
        : '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.cardPadding,
            AppSpacing.space6,
            AppSpacing.cardPadding,
            AppSpacing.cardPadding,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Handle
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: colors.hairline,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              AppSpacing.gapV5,
              Text(
                item.name,
                style: text.headlineSmall?.copyWith(color: colors.textPrimary),
              ),
              AppSpacing.gapV4,
              Divider(color: colors.hairline),
              AppSpacing.gapV3,
              _DetailRow('Zone', _zoneName(item.zone)),
              _DetailRow('Qty', showOrDash(item.qty)),
              _DetailRow('Unit', showOrDash(item.unit)),
              _DetailRow('Expiry', fmtDate(expiry)),
              _DetailRow(
                  'Price',
                  item.priceGbp == null
                      ? '—'
                      : '£${item.priceGbp!.toStringAsFixed(2)}'),
              _DetailRow('Store', showOrDash(item.store)),
              _DetailRow('Purchased', fmtDate(purchased)),
              _DetailRow('Last bought', fmtDate(lastBought)),
              _DetailRow(
                'Reorder every',
                item.reorderCadenceDays == null
                    ? '—'
                    : '${item.reorderCadenceDays} days',
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final isDash = value == '—';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.tightGap),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: text.bodyMedium?.copyWith(color: colors.textSecondary),
          ),
          Text(
            value,
            style: text.bodyMedium?.copyWith(
              color: isDash ? colors.textSecondary.withAlpha(102) : colors.textPrimary,
              fontWeight: isDash ? FontWeight.normal : FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Add / Edit form dialog ───────────────────────────────────────────────────

class _ItemFormDialog extends StatefulWidget {
  const _ItemFormDialog({this.existing});

  /// When non-null, the form is in edit mode.
  final PantryItem? existing;

  @override
  State<_ItemFormDialog> createState() => _ItemFormDialogState();
}

class _ItemFormDialogState extends State<_ItemFormDialog> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameCtrl;
  late final TextEditingController _qtyCtrl;
  late final TextEditingController _unitCtrl;
  late final TextEditingController _priceCtrl;
  late final TextEditingController _storeCtrl;
  late PantryZone _zone;
  DateTime? _expiry;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _nameCtrl = TextEditingController(text: e?.name ?? '');
    _qtyCtrl = TextEditingController(
        text: e?.qty != null ? e!.qty.toString() : '');
    _unitCtrl = TextEditingController(text: e?.unit ?? '');
    _priceCtrl = TextEditingController(
        text: e?.priceGbp != null ? e!.priceGbp.toString() : '');
    _storeCtrl = TextEditingController(text: e?.store ?? '');
    _zone = e?.zone ?? PantryZone.fridge;
    _expiry = e?.expiry;
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    _qtyCtrl.dispose();
    _unitCtrl.dispose();
    _priceCtrl.dispose();
    _storeCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final id = widget.existing?.id ??
        'item-${DateTime.now().microsecondsSinceEpoch}';

    final qtyText = _qtyCtrl.text.trim();
    final priceText = _priceCtrl.text.trim();

    final item = PantryItem(
      id: id,
      name: _nameCtrl.text.trim(),
      zone: _zone,
      qty: qtyText.isEmpty ? null : double.tryParse(qtyText),
      unit: _unitCtrl.text.trim().isEmpty ? null : _unitCtrl.text.trim(),
      expiry: _expiry,
      priceGbp: priceText.isEmpty ? null : double.tryParse(priceText),
      store: _storeCtrl.text.trim().isEmpty ? null : _storeCtrl.text.trim(),
      source: widget.existing?.source ?? 'manual',
    );

    Navigator.of(context).pop(item);
  }

  Future<void> _pickExpiry() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _expiry ?? DateTime.now().add(const Duration(days: 7)),
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 3650)),
    );
    if (picked != null) {
      setState(() => _expiry = picked);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.existing != null;
    return AlertDialog(
      title: Text(isEdit ? 'Edit item' : 'Add item'),
      content: SingleChildScrollView(
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Name (required)
              TextFormField(
                key: const Key('food-form-name'),
                controller: _nameCtrl,
                decoration: const InputDecoration(labelText: 'Name *'),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
                textCapitalization: TextCapitalization.sentences,
              ),
              const SizedBox(height: 8),
              // Zone picker
              DropdownButtonFormField<PantryZone>(
                key: const Key('food-form-zone'),
                initialValue: _zone,
                decoration: const InputDecoration(labelText: 'Zone'),
                items: PantryZone.values
                    .map((z) => DropdownMenuItem(
                          value: z,
                          child: Text(_zoneName(z)),
                        ))
                    .toList(),
                onChanged: (z) {
                  if (z != null) setState(() => _zone = z);
                },
              ),
              const SizedBox(height: 8),
              // Qty (optional)
              TextFormField(
                key: const Key('food-form-qty'),
                controller: _qtyCtrl,
                decoration: const InputDecoration(labelText: 'Qty (optional)'),
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
              ),
              const SizedBox(height: 8),
              // Unit (optional)
              TextFormField(
                key: const Key('food-form-unit'),
                controller: _unitCtrl,
                decoration:
                    const InputDecoration(labelText: 'Unit (optional, e.g. g, ml, pack)'),
              ),
              const SizedBox(height: 8),
              // Expiry (optional)
              Row(
                children: [
                  Expanded(
                    child: Text(
                      _expiry == null
                          ? 'Expiry: not set'
                          : 'Expiry: ${_expiry!.year}-${_expiry!.month.toString().padLeft(2, '0')}-${_expiry!.day.toString().padLeft(2, '0')}',
                    ),
                  ),
                  TextButton(
                    onPressed: _pickExpiry,
                    child: const Text('Pick date'),
                  ),
                  if (_expiry != null)
                    TextButton(
                      onPressed: () => setState(() => _expiry = null),
                      child: const Text('Clear'),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              // Price (optional)
              TextFormField(
                key: const Key('food-form-price'),
                controller: _priceCtrl,
                decoration:
                    const InputDecoration(labelText: 'Price £ (optional)'),
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
              ),
              const SizedBox(height: 8),
              // Store (optional)
              TextFormField(
                key: const Key('food-form-store'),
                controller: _storeCtrl,
                decoration:
                    const InputDecoration(labelText: 'Store (optional)'),
                textCapitalization: TextCapitalization.words,
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          key: const Key('food-form-submit'),
          onPressed: _submit,
          child: Text(isEdit ? 'Save' : 'Add'),
        ),
      ],
    );
  }
}
