// Cart page — grocery-list notepad + honest hand-off section (R-4 + R-5).
//
// The Cart is the honest, physical end of the eat → deplete → restock → cart
// loop: a real notepad you add to, check off, share, and hand off to a grocery
// delivery service via pre-searched deep-links (not a faked checkout).
//
// R-4 additions:
//   • "Share List" — share_plus sheet with unchecked items first, then checked.
//   • Per-item search icon — opens that item pre-searched in Amazon Fresh.
//   • Store buttons — Amazon Fresh / Instacart pre-searching the first unchecked
//     item.  Label: "Opens a search — add items there".
//   • "Grocery Delivery" section — requests location; shows all four services
//     as tappable links.  Permission denied → same list + honest note.
//
// R-5 addition (Instacart pre-filled cart):
//   • Instacart button now PREFERS a pre-filled shopping list (via the
//     `instacart-cart` edge function), which opens Instacart with ALL items
//     already loaded.  Falls back silently to the search deep-link when the
//     edge function is unavailable or returns an error, so the button always
//     does something useful.
//   • Honest label while loading: "Opening Instacart…"
//   • NEVER claims an order was placed or is in progress.
//
// Honesty rules (unchanged + extended):
//   • Every line is real user data — nothing is fabricated or pre-seeded.
//   • The "restock soon" suggestions come from REAL pantry data only.
//   • NEVER use "order", "checkout", "add to cart", "buy now" labels.
//   • Location section NEVER claims to verify delivery availability.
//   • Pre-filled link: if unavailable → fall back, never show a broken state.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../app_providers.dart';
import '../brain/brain_providers.dart';
import '../brain/insight.dart';
import '../cart/delivery_services.dart';
import '../cart/grocery_item.dart';
import '../cart/grocery_list_repo.dart';
import '../cart/instacart_client.dart';
import '../cart/link_launcher.dart';
import '../cart/location_service.dart';
import '../design_system/colors.dart';
import '../design_system/components/insight_card.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/spacing.dart';

class CartPage extends ConsumerStatefulWidget {
  const CartPage({
    super.key,
    this.repo,
    this.linkLauncher,
    this.locationService,
    this.instacartClient,
  });

  /// Optional overrides so widget tests can inject in-memory fakes without a
  /// ProviderScope. In the running app these come from the composition root.
  ///
  /// Note: the Cart's BUY (restock) insights now come from the SHARED Brain
  /// provider ([insightsForScreen]) rather than a directly-injected pantry repo,
  /// so a test seeding pantry data must override [pantryRepoProvider] via
  /// `ProviderScope` (the same way the Food page's tests do) — mirroring how the
  /// live interconnection actually flows.
  final GroceryListRepo? repo;
  final LinkLauncher? linkLauncher;
  final LocationService? locationService;

  /// Optional override for the Instacart pre-filled cart client. In the running
  /// app this comes from [instacartClientProvider] (via [ConsumerState]). Tests
  /// inject a [FakeInstacartClient] here so no network is ever touched.
  final InstacartClient? instacartClient;

  @override
  ConsumerState<CartPage> createState() => _CartPageState();
}

class _CartPageState extends ConsumerState<CartPage> {
  late final GroceryListRepo _repo =
      widget.repo ?? ref.read(groceryListRepoProvider);
  late final LinkLauncher _launcher =
      widget.linkLauncher ?? const RealLinkLauncher();
  late final LocationService _location =
      widget.locationService ?? const RealLocationService();

  // Resolved lazily so tests that inject via widget.instacartClient don't
  // trigger provider reads, and the real app reads the provider once on first
  // use. We resolve on the first _openInstacart call.
  InstacartClient? _instacartClientCache;

  InstacartClient get _instacartClient {
    if (_instacartClientCache != null) return _instacartClientCache!;
    _instacartClientCache =
        widget.instacartClient ?? ref.read(instacartClientProvider);
    return _instacartClientCache!;
  }

  final _addCtrl = TextEditingController();

  // Delivery near-me panel state.
  bool _deliveryExpanded = false;
  bool _deliveryLoading = false;
  List<DeliveryService> _deliveryResult = [];
  String? _deliveryDeniedNote;

  // Instacart pre-filled cart loading state.
  bool _instacartLoading = false;

  @override
  void dispose() {
    _addCtrl.dispose();
    super.dispose();
  }

  /// The current grocery list, read from the reactive [groceryListProvider] (the
  /// SAME source the nav's Cart badge reads). Watched in [build], so the rows
  /// re-render live on any change — including an item added from a BUY insight
  /// on another screen while this page stays alive under the nav's IndexedStack.
  /// Falls back to an empty list while the (fast, local) load resolves.
  List<GroceryItem> get _items =>
      ref.watch(groceryListProvider).valueOrNull ?? const [];

  /// The Brain's BUY insights for the Cart, via the SHARED provider (the same
  /// path Food uses), minus any whose item is ALREADY on the list (by name,
  /// case-insensitively) — we never nudge a duplicate. Reading through the
  /// provider (not a local computeInsights) keeps the interconnection live: a
  /// pantry mutation on another screen refreshes this list, and this screen's
  /// own mutations invalidate the snapshot for everyone else. De-dupes against
  /// the live [_items] (also provider-backed), so the moment an item is listed
  /// its suggestion drops — even when the add happened on another screen.
  List<Insight> _buyInsights(WidgetRef ref) {
    final onList = _items.map((i) => i.name.trim().toLowerCase()).toSet();
    return insightsForScreen(ref, BrainScreen.cart).where((i) {
      final name = i.action?.payload?.trim().toLowerCase();
      return name == null || !onList.contains(name);
    }).toList();
  }

  /// Refresh the reactive list + the shared Brain snapshot after a mutation, so
  /// every screen's list rows, Cart badge, and BrainSection re-read the truth.
  void _refresh() {
    ref.invalidate(groceryListProvider);
    ref.invalidate(brainInputsProvider);
  }

  Future<void> _add() async {
    final name = _addCtrl.text.trim();
    if (name.isEmpty) return;
    await _repo.add(name);
    if (!mounted) return;
    _addCtrl.clear();
    _refresh();
  }

  Future<void> _toggle(GroceryItem item) async {
    await _repo.toggle(item.id);
    if (!mounted) return;
    _refresh();
  }

  Future<void> _remove(GroceryItem item) async {
    await _repo.remove(item.id);
    if (!mounted) return;
    _refresh();
  }

  Future<void> _clearDone() async {
    await _repo.clearDone();
    if (!mounted) return;
    _refresh();
  }

  /// Route a Brain BUY insight action: add the real item to the list, then
  /// refresh the reactive list + Brain snapshot (so it drops out of the
  /// suggestions — it's now on the list — everywhere). Nothing faked; the same
  /// repo the list renders from is written.
  Future<void> _onInsightAction(InsightAction action) async {
    if (action.kind != InsightActionKind.addToCart) return;
    final name = action.payload;
    if (name == null || name.trim().isEmpty) return;
    await _repo.add(name);
    if (!mounted) return;
    _refresh();
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

  /// Open Instacart, preferring a pre-filled shopping list via the edge
  /// function. Falls back to the search deep-link if the edge function fails or
  /// is unavailable. Never claims an order was placed.
  ///
  /// When called without arguments, sends ALL current item names to the edge
  /// function so every item lands in the pre-filled cart. The fallback uses
  /// [_firstItemQuery] (the existing search behaviour) so the button is never
  /// a dead end.
  Future<void> _openInstacart([String? query]) async {
    // If called with an explicit query (legacy path), use the search link as-is.
    if (query != null) {
      await _launcher
          .launch(_serviceByName('Instacart').buildUri(query));
      return;
    }

    // Build the real list: names from the live item list (unchecked first, then
    // checked) — real user data, nothing fabricated.
    final allNames = [
      ..._items.where((i) => !i.done).map((i) => i.name),
      ..._items.where((i) => i.done).map((i) => i.name),
    ];

    if (allNames.isEmpty) {
      // Empty list → open Instacart store home (search link handles null).
      await _launcher
          .launch(_serviceByName('Instacart').buildUri(null));
      return;
    }

    setState(() => _instacartLoading = true);

    Uri? prefilled;
    try {
      prefilled = await _instacartClient.shoppingListUrl(allNames);
    } finally {
      if (mounted) setState(() => _instacartLoading = false);
    }

    if (!mounted) return;

    if (prefilled != null) {
      // Pre-filled list available — open it.
      await _launcher.launch(prefilled);
    } else {
      // Honest fallback: the edge function was unavailable or returned an error.
      // Fall back to the existing search deep-link so the button always works.
      await _launcher
          .launch(_serviceByName('Instacart').buildUri(_firstItemQuery));
    }
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

    // The reactive list — watched here (via [_items]) so the rows re-render live
    // on any change, including an add from another screen. Loading is the very
    // first (fast, local) resolve; after that a mutation invalidates the
    // provider and the rebuild carries the fresh list.
    final listAsync = ref.watch(groceryListProvider);
    final loading = listAsync.isLoading && !listAsync.hasValue;

    final doneCount = _items.where((i) => i.done).length;
    // The Brain's BUY insights via the shared provider (watched in build so a
    // pantry change elsewhere refreshes this list), minus what's already listed.
    final buyInsights = _buyInsights(ref);

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
      body: loading
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

                // Restock-soon offer — the Brain's BUY insights as connected
                // cards with a visible "why". ONLY when real pantry data has
                // something due that isn't already on the list. Omitted
                // otherwise (never a fabricated urgency). One-tap "Add to list"
                // writes the real item to the same list below.
                if (buyInsights.isNotEmpty) ...[
                  const SectionHeader(title: 'RESTOCK SOON'),
                  Column(
                    key: const Key('cart-restock-suggestions'),
                    children: [
                      for (var i = 0; i < buyInsights.length; i++) ...[
                        if (i > 0) AppSpacing.gapV3,
                        InsightCard(
                          insight: buyInsights[i],
                          onAction: _onInsightAction,
                        ),
                      ],
                    ],
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
                  instacartLoading: _instacartLoading,
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

/// The hand-off card: share + store deep-links + delivery near me.
///
/// Honest labels throughout — no "order", "checkout", "add to cart", "buy".
/// Instacart button prefers a pre-filled list; falls back to search silently.
class _HandoffSection extends StatelessWidget {
  const _HandoffSection({
    required this.items,
    required this.onShare,
    required this.onOpenAmazon,
    required this.onOpenInstacart,
    required this.instacartLoading,
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

  /// True while the [instacartClient] is fetching the pre-filled list URL.
  /// The button shows a loading state and is non-interactive during this time.
  final bool instacartLoading;

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
          //
          // Amazon Fresh: opens a search for the first item (unchanged).
          // Instacart: tries a pre-filled list first, falls back to search.
          // Neither button claims an order was placed.
          Text(
            'Opens Instacart with your list · Amazon searches the first item',
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
                  // Disabled while fetching the pre-filled URL so double-taps
                  // don't fire two separate launches.
                  onPressed: instacartLoading ? null : onOpenInstacart,
                  icon: instacartLoading
                      ? SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: colors.primaryStrong,
                          ),
                        )
                      : const Icon(Icons.open_in_new, size: 16),
                  label: Text(
                    instacartLoading ? 'Opening…' : 'Instacart',
                  ),
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
