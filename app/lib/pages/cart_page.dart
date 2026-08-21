// Cart page — a working grocery-list notepad (R-1).
//
// The Cart is the honest, physical end of the eat → deplete → restock → cart
// loop: a real notepad you add to, check off, and clear. It persists locally via
// [GroceryListRepo] (local-only in R-1 — no Supabase table yet; sync is a later
// phase). Optionally you can pull today's "restock soon" pantry items straight
// onto the list.
//
// Honesty rules:
//   • Every line is real user data — added by the user or an accepted "restock
//     soon" suggestion. Nothing is fabricated or pre-seeded.
//   • The "restock soon" suggestions come from REAL pantry data only (the pure
//     [restockSoon] selector); when nothing is due, the offer is simply absent.
//   • "Share / Export" REALLY copies the real list to the clipboard — it is not
//     a stub. The Amazon/Instacart deep-links + location are R-4 (not here).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../cart/grocery_item.dart';
import '../cart/grocery_list_repo.dart';
import '../design_system/colors.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/spacing.dart';
import '../pantry/pantry_glance.dart';
import '../pantry/pantry_repo.dart';

class CartPage extends ConsumerStatefulWidget {
  const CartPage({super.key, this.repo, this.pantryRepo});

  /// Optional overrides so widget tests can inject in-memory fakes without a
  /// ProviderScope. In the running app both come from the composition root.
  final GroceryListRepo? repo;
  final PantryRepo? pantryRepo;

  @override
  ConsumerState<CartPage> createState() => _CartPageState();
}

class _CartPageState extends ConsumerState<CartPage> {
  late final GroceryListRepo _repo =
      widget.repo ?? ref.read(groceryListRepoProvider);
  late final PantryRepo _pantry =
      widget.pantryRepo ?? ref.read(pantryRepoProvider);

  final _addCtrl = TextEditingController();

  List<GroceryItem> _items = [];
  List<RestockItem> _restock = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _addCtrl.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    final items = await _repo.all();
    final pantryItems = await _pantry.all();
    if (!mounted) return;
    final now = DateTime.now();
    setState(() {
      _items = items;
      // Only offer restock items that aren't already on the list (by name,
      // case-insensitively) — never nudge the user to add a duplicate.
      final onList =
          items.map((i) => i.name.trim().toLowerCase()).toSet();
      _restock = restockSoon(pantryItems, now)
          .where((r) => !onList.contains(r.item.name.trim().toLowerCase()))
          .toList();
      _loading = false;
    });
  }

  Future<void> _add() async {
    final name = _addCtrl.text.trim();
    if (name.isEmpty) return;
    final next = await _repo.add(name);
    if (!mounted) return;
    _addCtrl.clear();
    setState(() => _items = next);
    await _reload(); // refresh the restock offer (this name may now be on-list)
  }

  Future<void> _toggle(GroceryItem item) async {
    final next = await _repo.toggle(item.id);
    if (!mounted) return;
    setState(() => _items = next);
  }

  Future<void> _remove(GroceryItem item) async {
    final next = await _repo.remove(item.id);
    if (!mounted) return;
    setState(() => _items = next);
    await _reload();
  }

  Future<void> _clearDone() async {
    final next = await _repo.clearDone();
    if (!mounted) return;
    setState(() => _items = next);
    await _reload();
  }

  Future<void> _addRestock(RestockItem r) async {
    final next = await _repo.add(r.item.name);
    if (!mounted) return;
    setState(() => _items = next);
    await _reload();
  }

  /// REAL share: copy the current (unchecked-first) list to the clipboard as
  /// plain text. Not a stub — the deep-links come later (R-4).
  Future<void> _share() async {
    if (_items.isEmpty) return;
    final lines = _items
        .map((i) => '${i.done ? '[x]' : '[ ]'} ${i.name}')
        .join('\n');
    await Clipboard.setData(ClipboardData(text: lines));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        key: Key('cart-share-snackbar'),
        content: Text('Grocery list copied to clipboard'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    final doneCount = _items.where((i) => i.done).length;

    return Scaffold(
      key: const Key('cart-page'),
      backgroundColor: colors.canvas,
      appBar: AppBar(
        title: const Text('Cart'),
        backgroundColor: colors.canvas,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            key: const Key('cart-share'),
            onPressed: _items.isEmpty ? null : _share,
            tooltip: 'Share / Export',
            icon: const Icon(Icons.ios_share),
          ),
        ],
      ),
      body: _loading
          ? const SizedBox.shrink()
          : ListView(
              padding: AppSpacing.pagePadding,
              children: [
                // Add row — the notepad's pencil.
                StatCard(
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: const Key('cart-add-field'),
                          controller: _addCtrl,
                          textCapitalization: TextCapitalization.sentences,
                          onSubmitted: (_) => _add(),
                          decoration: const InputDecoration(
                            hintText: 'Add an item…',
                            border: InputBorder.none,
                          ),
                        ),
                      ),
                      IconButton(
                        key: const Key('cart-add-btn'),
                        onPressed: _add,
                        tooltip: 'Add',
                        icon: Icon(Icons.add, color: colors.primaryStrong),
                      ),
                    ],
                  ),
                ),
                AppSpacing.gapV6,

                // Restock-soon offer — ONLY when real pantry data has something
                // due that isn't already on the list. Omitted otherwise.
                if (_restock.isNotEmpty) ...[
                  const SectionHeader(title: 'RESTOCK SOON'),
                  StatCard(
                    key: const Key('cart-restock-suggestions'),
                    padding: EdgeInsets.zero,
                    child: Column(
                      children: [
                        for (var i = 0; i < _restock.length; i++) ...[
                          if (i > 0)
                            Divider(
                                height: 1,
                                thickness: 1,
                                color: colors.hairline),
                          ListTile(
                            title: Text(_restock[i].item.name),
                            subtitle: Text(
                              _restockReasonLabel(_restock[i]),
                              style: text.bodySmall
                                  ?.copyWith(color: colors.textSecondary),
                            ),
                            trailing: IconButton(
                              key: Key('cart-restock-add-${_restock[i].item.id}'),
                              icon: Icon(Icons.add_circle_outline,
                                  color: colors.primaryStrong),
                              tooltip: 'Add to list',
                              onPressed: () => _addRestock(_restock[i]),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  AppSpacing.gapV6,
                ],

                // The list itself.
                SectionHeader(
                  title: 'GROCERY LIST',
                  trailing: doneCount > 0
                      ? TextButton(
                          key: const Key('cart-clear-done'),
                          onPressed: _clearDone,
                          child: const Text('Clear done'),
                        )
                      : null,
                ),
                if (_items.isEmpty)
                  _EmptyList()
                else
                  StatCard(
                    padding: EdgeInsets.zero,
                    child: Column(
                      children: [
                        for (var i = 0; i < _items.length; i++) ...[
                          if (i > 0)
                            Divider(
                                height: 1,
                                thickness: 1,
                                color: colors.hairline),
                          _GroceryRow(
                            item: _items[i],
                            onToggle: () => _toggle(_items[i]),
                            onRemove: () => _remove(_items[i]),
                          ),
                        ],
                      ],
                    ),
                  ),
              ],
            ),
    );
  }

  String _restockReasonLabel(RestockItem r) {
    final parts = <String>[
      if (r.isExpiring) 'expiring soon',
      if (r.isLow) 'running low',
      if (r.isReorderDue) 'reorder due',
    ];
    return parts.join(' · ');
  }
}

// ── _GroceryRow ──────────────────────────────────────────────────────────────

class _GroceryRow extends StatelessWidget {
  const _GroceryRow({
    required this.item,
    required this.onToggle,
    required this.onRemove,
  });

  final GroceryItem item;
  final VoidCallback onToggle;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Row(
      children: [
        Checkbox(
          key: Key('cart-check-${item.id}'),
          value: item.done,
          onChanged: (_) => onToggle(),
        ),
        Expanded(
          child: Text(
            item.name,
            style: text.bodyLarge?.copyWith(
              color: item.done ? colors.textSecondary : colors.textPrimary,
              decoration:
                  item.done ? TextDecoration.lineThrough : TextDecoration.none,
            ),
          ),
        ),
        IconButton(
          key: Key('cart-remove-${item.id}'),
          icon: Icon(Icons.close, size: 18, color: colors.textSecondary),
          tooltip: 'Remove',
          visualDensity: VisualDensity.compact,
          onPressed: onRemove,
        ),
      ],
    );
  }
}

// ── _EmptyList ───────────────────────────────────────────────────────────────

class _EmptyList extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    return StatCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Your list is empty', style: text.titleMedium),
          AppSpacing.gapV2,
          Text(
            'Add items above, or pull in what’s running low from your kitchen.',
            style: text.bodyMedium?.copyWith(color: colors.textSecondary),
          ),
        ],
      ),
    );
  }
}
