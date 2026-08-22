// Cart page — grocery-list notepad + honest hand-off section (R-4).
//
// The Cart is the honest, physical end of the eat → deplete → restock → cart
// loop: a real notepad you add to, check off, share, and hand off to a grocery
// delivery service via pre-searched deep-links (not a faked checkout).
//
// R-4 additions (this file):
//   • "Share List" — share_plus sheet with unchecked items first, then checked.
//   • Per-item search icon — opens that item pre-searched in Amazon Fresh.
//   • Store buttons — Amazon Fresh / Instacart pre-searching the first unchecked
//     item.  Label: "Opens a search — add items there".
//   • "Grocery Delivery" section — requests location; shows all four services
//     as tappable links.  Permission denied → same list + honest note.
//
// Honesty rules (unchanged + extended):
//   • Every line is real user data — nothing is fabricated or pre-seeded.
//   • The "restock soon" suggestions come from REAL pantry data only.
//   • NEVER use "order", "checkout", "add to cart", "buy now" labels.
//   • Location section NEVER claims to verify delivery availability.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../app_providers.dart';
import '../cart/delivery_services.dart';
import '../cart/grocery_item.dart';
import '../cart/grocery_list_repo.dart';
import '../cart/link_launcher.dart';
import '../cart/location_service.dart';
import '../design_system/colors.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/spacing.dart';
import '../pantry/pantry_glance.dart';
import '../pantry/pantry_repo.dart';

class CartPage extends ConsumerStatefulWidget {
  const CartPage({
    super.key,
    this.repo,
    this.pantryRepo,
    this.linkLauncher,
    this.locationService,
  });

  /// Optional overrides so widget tests can inject in-memory fakes without a
  /// ProviderScope. In the running app these come from the composition root.
  final GroceryListRepo? repo;
  final PantryRepo? pantryRepo;
  final LinkLauncher? linkLauncher;
  final LocationService? locationService;

  @override
  ConsumerState<CartPage> createState() => _CartPageState();
}

class _CartPageState extends ConsumerState<CartPage> {
  late final GroceryListRepo _repo =
      widget.repo ?? ref.read(groceryListRepoProvider);
  late final PantryRepo _pantry =
      widget.pantryRepo ?? ref.read(pantryRepoProvider);
  late final LinkLauncher _launcher =
      widget.linkLauncher ?? const RealLinkLauncher();
  late final LocationService _location =
      widget.locationService ?? const RealLocationService();

  final _addCtrl = TextEditingController();

  List<GroceryItem> _items = [];
  List<RestockItem> _restock = [];
  bool _loading = true;

  // Delivery near-me panel state.
  bool _deliveryExpanded = false;
  bool _deliveryLoading = false;
  List<DeliveryService> _deliveryResult = [];
  String? _deliveryDeniedNote;

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
    await _reload();
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

  // ── Legacy clipboard copy (AppBar icon) ──────────────────────────────────

  Future<void> _copyToClipboard() async {
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

  // ── Share via OS sheet ────────────────────────────────────────────────────

  /// Share the list via the OS share sheet.
  /// Unchecked items first (what's still needed), then checked (already got).
  Future<void> _shareList() async {
    if (_items.isEmpty) return;
    final unchecked = _items.where((i) => !i.done).toList();
    final checked = _items.where((i) => i.done).toList();
    final lines = [
      ...unchecked.map((i) => '• ${i.name}'),
      if (checked.isNotEmpty) ...[
        '',
        'Already got:',
        ...checked.map((i) => '✓ ${i.name}'),
      ],
    ].join('\n');
    await SharePlus.instance.share(ShareParams(text: lines));
  }

  // ── Store deep-links ─────────────────────────────────────────────────────

  /// First unchecked item name, or first item if all are checked, or null.
  String? get _firstItemQuery {
    if (_items.isEmpty) return null;
    final unchecked = _items.where((i) => !i.done);
    return unchecked.isNotEmpty ? unchecked.first.name : _items.first.name;
  }

  DeliveryService _serviceByName(String name) =>
      deliveryServices.firstWhere((s) => s.name == name);

  Future<void> _openAmazon([String? query]) async {
    await _launcher
        .launch(_serviceByName('Amazon Fresh').buildUri(query ?? _firstItemQuery));
  }

  Future<void> _openInstacart([String? query]) async {
    await _launcher
        .launch(_serviceByName('Instacart').buildUri(query ?? _firstItemQuery));
  }

  // ── Delivery near me ─────────────────────────────────────────────────────

  Future<void> _onDeliveryNearMe() async {
    // Toggle collapse.
    if (_deliveryExpanded) {
      setState(() => _deliveryExpanded = false);
      return;
    }
    setState(() {
      _deliveryExpanded = true;
      _deliveryLoading = true;
    });

    final result = await _location.getLocation();

    if (!mounted) return;
    setState(() {
      _deliveryLoading = false;
      _deliveryResult = deliveryServices;
      _deliveryDeniedNote = result.isSuccess
          ? null
          : 'These deliver in many areas — open each to check delivery to your address';
    });
  }

  // ── Build ─────────────────────────────────────────────────────────────────

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
            onPressed: _items.isEmpty ? null : _copyToClipboard,
            tooltip: 'Copy list to clipboard',
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
                              key: Key(
                                  'cart-restock-add-${_restock[i].item.id}'),
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
                            // Per-item search: opens this item in Amazon Fresh.
                            onSearch: () => _openAmazon(_items[i].name),
                          ),
                        ],
                      ],
                    ),
                  ),

                AppSpacing.gapV8,

                // ── Hand-off section ────────────────────────────────────────
                const SectionHeader(title: 'HAND-OFF'),
                _HandoffSection(
                  items: _items,
                  onShare: _items.isEmpty ? null : _shareList,
                  onOpenAmazon: _openAmazon,
                  onOpenInstacart: _openInstacart,
                  onDeliveryNearMe: _onDeliveryNearMe,
                  deliveryExpanded: _deliveryExpanded,
                  deliveryLoading: _deliveryLoading,
                  deliveryResult: _deliveryResult,
                  deliveryDeniedNote: _deliveryDeniedNote,
                  launcher: _launcher,
                  firstItemQuery: _firstItemQuery,
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
    required this.onSearch,
  });

  final GroceryItem item;
  final VoidCallback onToggle;
  final VoidCallback onRemove;
  final VoidCallback onSearch;

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
        // Per-item search — "Search in Amazon Fresh", never "Buy on Amazon".
        IconButton(
          key: Key('cart-item-search-${item.id}'),
          icon: Icon(Icons.search, size: 18, color: colors.textSecondary),
          tooltip: 'Search in Amazon Fresh',
          visualDensity: VisualDensity.compact,
          onPressed: onSearch,
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

// ── _HandoffSection ──────────────────────────────────────────────────────────

/// The R-4 hand-off card: share + store deep-links + delivery near me.
///
/// Honest labels throughout — no "order", "checkout", "add to cart", "buy".
class _HandoffSection extends StatelessWidget {
  const _HandoffSection({
    required this.items,
    required this.onShare,
    required this.onOpenAmazon,
    required this.onOpenInstacart,
    required this.onDeliveryNearMe,
    required this.deliveryExpanded,
    required this.deliveryLoading,
    required this.deliveryResult,
    required this.deliveryDeniedNote,
    required this.launcher,
    required this.firstItemQuery,
  });

  final List<GroceryItem> items;
  final VoidCallback? onShare;
  final VoidCallback onOpenAmazon;
  final VoidCallback onOpenInstacart;
  final VoidCallback onDeliveryNearMe;
  final bool deliveryExpanded;
  final bool deliveryLoading;
  final List<DeliveryService> deliveryResult;
  final String? deliveryDeniedNote;
  final LinkLauncher launcher;
  final String? firstItemQuery;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return StatCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // a. Share the list via OS share sheet.
          FilledButton.icon(
            key: const Key('cart-share-sheet'),
            onPressed: onShare,
            icon: const Icon(Icons.share),
            label: const Text('Share List'),
            style: FilledButton.styleFrom(
              backgroundColor: colors.primary,
              foregroundColor: colors.textPrimary,
            ),
          ),

          AppSpacing.gapV4,

          // b. Store buttons: Amazon Fresh + Instacart, honest labels.
          Text(
            'Opens a search — add items there',
            style: text.bodySmall?.copyWith(color: colors.textSecondary),
            textAlign: TextAlign.center,
          ),
          AppSpacing.gapV2,
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  key: const Key('cart-amazon'),
                  onPressed: onOpenAmazon,
                  icon: const Icon(Icons.open_in_new, size: 16),
                  label: const Text('Amazon Fresh'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: colors.primaryStrong,
                    side: BorderSide(color: colors.primaryStrong),
                  ),
                ),
              ),
              AppSpacing.gapH3,
              Expanded(
                child: OutlinedButton.icon(
                  key: const Key('cart-instacart'),
                  onPressed: onOpenInstacart,
                  icon: const Icon(Icons.open_in_new, size: 16),
                  label: const Text('Instacart'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: colors.primaryStrong,
                    side: BorderSide(color: colors.primaryStrong),
                  ),
                ),
              ),
            ],
          ),

          AppSpacing.gapV4,

          // d. Delivery near me — requests location, then shows service list.
          OutlinedButton.icon(
            key: const Key('cart-delivery-near-me'),
            onPressed: onDeliveryNearMe,
            icon: Icon(
              deliveryExpanded
                  ? Icons.expand_less
                  : Icons.location_on_outlined,
              size: 16,
            ),
            label: const Text('Grocery Delivery'),
            style: OutlinedButton.styleFrom(
              foregroundColor: colors.textSecondary,
              side: BorderSide(color: colors.hairline),
            ),
          ),

          if (deliveryExpanded) ...[
            AppSpacing.gapV4,
            if (deliveryLoading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(AppSpacing.space4),
                  child: CircularProgressIndicator(),
                ),
              )
            else ...[
              if (deliveryDeniedNote != null)
                Padding(
                  padding:
                      const EdgeInsets.only(bottom: AppSpacing.space3),
                  child: Text(
                    deliveryDeniedNote!,
                    key: const Key('cart-delivery-denied-note'),
                    style: text.bodySmall
                        ?.copyWith(color: colors.textSecondary),
                  ),
                ),
              // Service list — always shown with or without real location.
              for (final service in deliveryResult)
                ListTile(
                  key: Key(
                    'cart-delivery-${service.name.toLowerCase().replaceAll(' ', '-')}',
                  ),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    service.name,
                    style: text.bodyMedium
                        ?.copyWith(color: colors.primaryStrong),
                  ),
                  subtitle: Text(
                    'Open to check delivery to your address',
                    style: text.bodySmall
                        ?.copyWith(color: colors.textSecondary),
                  ),
                  trailing: Icon(
                    Icons.open_in_new,
                    size: 16,
                    color: colors.textSecondary,
                  ),
                  onTap: () =>
                      launcher.launch(service.buildUri(firstItemQuery)),
                ),
            ],
          ],
        ],
      ),
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
