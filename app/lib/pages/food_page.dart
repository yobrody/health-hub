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
class _FreshnessDot extends StatelessWidget {
  const _FreshnessDot(this.freshness);

  final Freshness freshness;

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
    return Container(
      key: Key('freshness-${freshness.name}'),
      width: 10,
      height: 10,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
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

  // ── Detail sheet ───────────────────────────────────────────────────────────

  void _showDetail(PantryItem item) {
    showModalBottomSheet<void>(
      context: context,
      builder: (_) => _DetailSheet(item: item),
    );
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: const Key('food-page'),
      appBar: AppBar(title: const Text('Fridge & Pantry')),
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
    if (_items.isEmpty) {
      return const Center(
        child: Text(
          'No items yet. Tap + to add one.',
          style: TextStyle(color: Colors.grey),
        ),
      );
    }

    final now = DateTime.now();
    final sections = <Widget>[];

    for (final zone in _zoneOrder) {
      final zoneItems = _items.where((i) => i.zone == zone).toList();
      if (zoneItems.isEmpty) continue;

      sections.add(
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
          child: Text(
            _zoneName(zone),
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: Theme.of(context).colorScheme.primary,
                  fontWeight: FontWeight.bold,
                ),
          ),
        ),
      );

      for (final item in zoneItems) {
        final freshness = freshnessOf(item, now);
        final qtyDisplay = item.qty == null
            ? '—'
            : (item.unit != null
                ? '${item.qty} ${item.unit}'
                : '${item.qty}');

        sections.add(
          ListTile(
            leading: _FreshnessDot(freshness),
            title: Text(item.name),
            subtitle: Text(qtyDisplay),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: () => _openEditForm(item),
                  tooltip: 'Edit',
                ),
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _delete(item.id),
                  tooltip: 'Delete',
                ),
              ],
            ),
            onTap: () => _showDetail(item),
          ),
        );
      }
    }

    return ListView(children: sections);
  }
}

// ── Detail sheet ──────────────────────────────────────────────────────────────

class _DetailSheet extends StatelessWidget {
  const _DetailSheet({required this.item});

  final PantryItem item;

  @override
  Widget build(BuildContext context) {
    final expiry = item.expiry;
    final purchased = item.purchasedAt;
    final lastBought = item.lastBought;

    String fmtDate(DateTime? d) =>
        d == null ? '—' : '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(item.name, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 12),
            _DetailRow('Zone', _zoneName(item.zone)),
            _DetailRow('Qty', showOrDash(item.qty)),
            _DetailRow('Unit', showOrDash(item.unit)),
            _DetailRow('Expiry', fmtDate(expiry)),
            _DetailRow('Price', item.priceGbp == null ? '—' : '£${item.priceGbp!.toStringAsFixed(2)}'),
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
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final isDash = value == '—';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodyMedium),
          Text(
            value,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: isDash ? Theme.of(context).disabledColor : null,
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
