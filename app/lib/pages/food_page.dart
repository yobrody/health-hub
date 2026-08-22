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

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../capture/camera_service.dart';
import '../design_system/colors.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/motion.dart';
import '../design_system/shape.dart';
import '../design_system/spacing.dart';
import '../kitchen/kitchen_layout.dart';
import '../pantry/pantry_item.dart';
import '../pantry/pantry_repo.dart';
import '../pantry/recognition/pantry_recognition.dart';
import '../pantry/recognition/recognition_client.dart';
import '../pantry/shelf_life.dart';
import '../profile/profile_model.dart'; // showOrDash
import 'pantry_recognition_page.dart';

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

/// The kitchen appliance label for a zone. Differs from [_zoneName] only for
/// condiments, which read as "Spices" on the kitchen scene (the detail sheet +
/// add form keep the canonical "Condiments" via [_zoneName]).
String _kitchenZoneLabel(PantryZone zone) =>
    zone == PantryZone.condiments ? 'Spices' : _zoneName(zone);

/// The kitchen icon for each appliance panel.
IconData _zoneIcon(PantryZone zone) {
  switch (zone) {
    case PantryZone.fridge:
      return Icons.kitchen_outlined;
    case PantryZone.pantry:
      return Icons.shelves;
    case PantryZone.freezer:
      return Icons.ac_unit;
    case PantryZone.condiments:
      return Icons.local_dining_outlined;
  }
}

/// All zones in display order.
const _zoneOrder = [
  PantryZone.fridge,
  PantryZone.pantry,
  PantryZone.freezer,
  PantryZone.condiments,
];

/// The three zones that support a single/double appliance toggle. Spices
/// (condiments) is always a single rack, so it is excluded.
const Map<PantryZone, ToggleableAppliance> _toggleableFor = {
  PantryZone.fridge: ToggleableAppliance.fridge,
  PantryZone.pantry: ToggleableAppliance.pantry,
  PantryZone.freezer: ToggleableAppliance.freezer,
};

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
  ConsumerState<FoodPage> createState() => FoodPageState();
}

class FoodPageState extends ConsumerState<FoodPage> {
  List<PantryItem> _items = [];
  KitchenLayout _layout = KitchenLayout.initial;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  PantryRepo get _repo => ref.read(pantryRepoProvider);
  KitchenLayoutRepo get _layoutRepo => ref.read(kitchenLayoutRepoProvider);

  Future<void> _reload() async {
    final items = await _repo.all();
    final layout = await _layoutRepo.load();
    if (!mounted) return;
    setState(() {
      _items = items;
      _layout = layout;
      _loading = false;
    });
  }

  /// Toggle an appliance single⇄double. COSMETIC ONLY — persists the display
  /// preference; never touches item data or invents stock.
  Future<void> _toggleAppliance(ToggleableAppliance appliance) async {
    final next = await _layoutRepo.toggle(appliance);
    if (!mounted) return;
    setState(() => _layout = next);
  }

  /// Open a single zone's real contents (the tappable items). Items reload on
  /// return so an edit/delete inside the zone view is reflected on the scene.
  Future<void> _openZone(PantryZone zone) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => _ZoneView(
          zone: zone,
          onShowDetail: _showDetail,
          onEdit: _openEditForm,
          onDelete: _delete,
        ),
      ),
    );
    if (!mounted) return;
    await _reload();
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

  bool _recognizing = false;

  /// Camera/gallery driver for the upload path (R-2). NOT unit-tested — it opens
  /// [CameraService] (the `image_picker` plugin, real hardware). It captures one
  /// or more photos, reads their bytes, and hands them to [runRecognition] (the
  /// testable seam). Tests call [runRecognition] directly with fake bytes.
  Future<void> _uploadPhotos() async {
    final camera = CameraService();
    final images = <Uint8List>[];

    // Let the user add several photos (fridge, freezer, pantry, spices). We
    // loop on the camera; the user cancels to stop.
    while (true) {
      final path = await camera.pickImage(
        source: CaptureSource.camera,
        maxWidth: 1600,
        maxHeight: 1600,
      );
      if (path == null) break; // cancelled / no more
      try {
        final bytes = await XImageBytes.read(path);
        if (bytes != null) images.add(bytes);
      } catch (_) {
        // Unreadable file — skip it rather than fabricating anything.
      }
      if (!mounted) return;
      final more = await _askAddMore();
      if (!more) break;
    }

    if (!mounted) return;
    if (images.isEmpty) return; // nothing captured — no-op, nothing invented
    await runRecognition(images);
  }

  Future<bool> _askAddMore() async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        content: const Text('Add another photo?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Done'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Add photo'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  /// The TESTABLE recognition seam. Sends [images] to the recognizer, then on
  /// success pushes the confirm-before-save screen. HONEST throughout:
  ///  • A recognition failure surfaces an honest error snackbar and saves
  ///    NOTHING — it never fabricates items.
  ///  • The confirm screen is where the user reviews suggestions; nothing is
  ///    written to the pantry until they confirm there.
  /// Public (no `_`) so widget tests drive it directly with fake image bytes,
  /// exactly like nutrition_page's `handleBarcodeResult`.
  @visibleForTesting
  Future<void> runRecognition(List<Uint8List> images) async {
    if (_recognizing) return;
    setState(() => _recognizing = true);

    RecognitionResult result;
    try {
      final client = ref.read(pantryRecognitionClientProvider);
      result = await client.recognize(images);
    } on RecognitionFailure catch (e) {
      if (!mounted) return;
      setState(() => _recognizing = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          key: const Key('food-gate-upload-snackbar'),
          content: Text(e.message),
        ),
      );
      return;
    } catch (_) {
      if (!mounted) return;
      setState(() => _recognizing = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          key: Key('food-gate-upload-snackbar'),
          content: Text('Recognition failed. Add items manually.'),
        ),
      );
      return;
    }

    if (!mounted) return;
    setState(() => _recognizing = false);

    // Push the confirm screen for BOTH the populated and empty cases — the
    // empty case shows an honest "couldn't identify" fallback. Only confirmed
    // items are saved (inside the confirm screen).
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => PantryRecognitionPage(result: result),
      ),
    );
    if (saved == true) {
      await _reload();
    }
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
                  'Snap your fridge, freezer, pantry & spices — AI suggests '
                  'what it sees, you confirm before anything is saved. Or add '
                  'items manually.',
                  style:
                      text.bodyMedium?.copyWith(color: colors.textSecondary),
                ),
                AppSpacing.gapV5,
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    key: const Key('food-gate-upload'),
                    onPressed: _recognizing ? null : _uploadPhotos,
                    icon: _recognizing
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.photo_camera_outlined),
                    label: Text(
                        _recognizing ? 'Recognizing…' : 'Snap photos'),
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

    // ── The interactive kitchen (R-3) ──────────────────────────────────────
    // A stylized, tappable kitchen scene: one appliance panel per zone, drawn
    // with the design system (warm surfaces, depth, rounded appliance shapes).
    // Each panel shows the zone's REAL item count + (only when real) an
    // "N expiring" badge from genuine expiry data. Tapping a panel opens that
    // zone's real contents.
    //
    // NOTE (future): an illustrated kitchen background could be layered behind
    // these panels later; the stylized panels here meet the R-3 bar on their own.
    final now = DateTime.now();
    final noAnim = MediaQuery.of(context).disableAnimations;

    final list = ListView(
      key: const Key('kitchen-scene'),
      padding: AppSpacing.pagePadding,
      children: [
        Text(
          'Your kitchen',
          style: text.headlineSmall?.copyWith(color: colors.textPrimary),
        ),
        AppSpacing.gapV2,
        Text(
          "Tap an appliance to see what's inside.",
          style: text.bodyMedium?.copyWith(color: colors.textSecondary),
        ),
        AppSpacing.gapV6,
        for (final zone in _zoneOrder) ...[
          _AppliancePanel(
            zone: zone,
            items: _items.where((i) => i.zone == zone).toList(),
            now: now,
            size: _toggleableFor[zone] == null
                ? ApplianceSize.single
                : _layout.sizeOf(_toggleableFor[zone]!),
            onTap: () => _openZone(zone),
            onToggle: _toggleableFor[zone] == null
                ? null
                : () => _toggleAppliance(_toggleableFor[zone]!),
          ),
          AppSpacing.gapV4,
        ],
      ],
    );

    // R-5 entrance animation on the kitchen list — same pattern as TodayPage.
    // Finite so pumpAndSettle completes in tests. Skipped with reduced-motion.
    if (noAnim) return list;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: AppMotion.slow,
      curve: AppMotion.enter,
      builder: (context, t, child) => Opacity(
        opacity: t,
        child: Transform.translate(
          offset: Offset(0, (1 - t) * 16),
          child: child,
        ),
      ),
      child: list,
    );
  }
}

// ── _AppliancePanel ───────────────────────────────────────────────────────────

/// One stylized appliance in the kitchen scene: fridge / pantry / freezer /
/// spices. A tappable rounded surface resembling an appliance, showing the
/// zone's REAL item count and — only when there's genuine expiry data — an
/// "N expiring" badge. A [size] of [ApplianceSize.double_] renders taller (a
/// larger / second unit) — a purely COSMETIC capacity cue that never implies
/// any extra stock.
class _AppliancePanel extends StatelessWidget {
  const _AppliancePanel({
    required this.zone,
    required this.items,
    required this.now,
    required this.size,
    required this.onTap,
    required this.onToggle,
  });

  final PantryZone zone;
  final List<PantryItem> items;
  final DateTime now;
  final ApplianceSize size;
  final VoidCallback onTap;

  /// Null for spices (no single/double toggle).
  final VoidCallback? onToggle;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final isDouble = size.isDouble;

    // REAL data only: the count of items genuinely in this zone, and the count
    // with a REAL expiry at/before now (already expired or use-by passed) — an
    // honest urgency cue, omitted entirely when zero (never fabricated).
    final count = items.length;
    final expiringCount = items.where((i) {
      final freshness = freshnessOf(i, now);
      return freshness == Freshness.useSoon || freshness == Freshness.expired;
    }).length;

    final label = _kitchenZoneLabel(zone);
    // A double appliance draws taller — a visual "more capacity" cue only.
    final minHeight = isDouble ? 132.0 : 96.0;

    return AnimatedContainer(
      key: Key('kitchen-zone-${zone.name}'),
      duration: AppMotion.base,
      curve: AppMotion.standard,
      constraints: BoxConstraints(minHeight: minHeight),
      decoration: BoxDecoration(
        // Appliance body: warm surface with a soft gradient for depth so it
        // reads as a stylized appliance, not a flat card.
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [colors.surfaceWarm, colors.surface],
        ),
        borderRadius: AppShape.card,
        border: Border.all(color: colors.hairline),
        boxShadow: AppShape.cardShadow(Theme.of(context).brightness),
      ),
      clipBehavior: Clip.antiAlias,
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          borderRadius: AppShape.card,
          splashColor: colors.primary.withValues(alpha: 0.08),
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.cardPadding),
            child: Row(
              children: [
                // Appliance "door" — an icon plaque; a double shows two plates.
                _AppliancePlate(
                  icon: _zoneIcon(zone),
                  isDouble: isDouble,
                  color: colors.primaryStrong,
                  surface: colors.surface,
                  border: colors.hairline,
                ),
                AppSpacing.gapH4,
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Row(
                        children: [
                          Text(
                            label,
                            style: text.titleMedium?.copyWith(
                              color: colors.textPrimary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          if (isDouble) ...[
                            AppSpacing.gapH2,
                            _DoubleBadge(colors: colors, text: text),
                          ],
                        ],
                      ),
                      AppSpacing.gapV1,
                      // R-5: cross-fade the count text when it changes.
                      // AnimatedSwitcher is finite — pumpAndSettle completes.
                      AnimatedSwitcher(
                        duration: AppMotion.fast,
                        child: Text(
                          // Real count, honestly singular/plural. Zero → still
                          // honest ("empty") rather than hidden.
                          count == 0
                              ? 'Empty'
                              : '$count ${count == 1 ? 'item' : 'items'}',
                          key: ValueKey(count),
                          style: text.bodyMedium?.copyWith(
                            color: colors.textSecondary,
                          ),
                        ),
                      ),
                      if (expiringCount > 0) ...[
                        AppSpacing.gapV2,
                        _ExpiringBadge(
                          count: expiringCount,
                          colors: colors,
                          text: text,
                        ),
                      ],
                    ],
                  ),
                ),
                // Single/double toggle (fridge/pantry/freezer only).
                if (onToggle != null)
                  IconButton(
                    key: Key('kitchen-toggle-${zone.name}'),
                    onPressed: onToggle,
                    tooltip: isDouble
                        ? 'Switch to a single $label'
                        : 'Switch to a double $label',
                    icon: Icon(
                      isDouble
                          ? Icons.splitscreen_outlined
                          : Icons.add_box_outlined,
                      color: colors.textSecondary,
                    ),
                  ),
                Icon(Icons.chevron_right, color: colors.textSecondary),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The appliance "door" plaque — a rounded plate with the zone icon. A double
/// draws a faint second plate behind it (cosmetic capacity cue).
class _AppliancePlate extends StatelessWidget {
  const _AppliancePlate({
    required this.icon,
    required this.isDouble,
    required this.color,
    required this.surface,
    required this.border,
  });

  final IconData icon;
  final bool isDouble;
  final Color color;
  final Color surface;
  final Color border;

  @override
  Widget build(BuildContext context) {
    Widget plate({Color? bg}) => Container(
          width: 44,
          height: 56,
          decoration: BoxDecoration(
            color: bg ?? surface,
            borderRadius: AppShape.button,
            border: Border.all(color: border),
          ),
          child: Icon(icon, color: color),
        );

    if (!isDouble) return plate();

    // Two units side by side for a double appliance.
    return SizedBox(
      width: 62,
      height: 56,
      child: Stack(
        children: [
          Positioned(left: 18, top: 0, child: plate(bg: surface)),
          Positioned(left: 0, top: 0, child: plate(bg: surface)),
        ],
      ),
    );
  }
}

/// A small "Double" pill next to the appliance name when it's in double mode.
class _DoubleBadge extends StatelessWidget {
  const _DoubleBadge({required this.colors, required this.text});
  final AppColors colors;
  final TextTheme text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: colors.primary.withValues(alpha: 0.16),
        borderRadius: AppShape.chip,
      ),
      child: Text(
        'Double',
        style: text.labelSmall?.copyWith(
          color: colors.primaryStrong,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// The honest "N expiring" badge — shown only when [count] > 0 (real expiry
/// data). Never fabricates urgency.
class _ExpiringBadge extends StatelessWidget {
  const _ExpiringBadge({
    required this.count,
    required this.colors,
    required this.text,
  });
  final int count;
  final AppColors colors;
  final TextTheme text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.orange.withValues(alpha: 0.16),
        borderRadius: AppShape.chip,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.schedule, size: 13, color: Colors.orange),
          AppSpacing.gapH1,
          Text(
            '$count expiring',
            style: text.labelSmall?.copyWith(
              color: colors.textPrimary,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

// ── _ZoneView (tap a zone → its real contents) ────────────────────────────────

/// The opened contents of a single zone: its REAL items (from the repo, filtered
/// by [zone]), each tappable → the item-facts sheet. An empty zone shows an
/// honest empty state ("Fridge is empty") — never a fabricated item. Items load
/// once here (the parent reloads on return), and the list fades/slides in
/// (design-system motion) — a finite entrance, so `pumpAndSettle` never hangs.
class _ZoneView extends ConsumerStatefulWidget {
  const _ZoneView({
    required this.zone,
    required this.onShowDetail,
    required this.onEdit,
    required this.onDelete,
  });

  final PantryZone zone;
  final void Function(PantryItem) onShowDetail;
  final Future<void> Function(PantryItem) onEdit;
  final Future<void> Function(String id) onDelete;

  @override
  ConsumerState<_ZoneView> createState() => _ZoneViewState();
}

class _ZoneViewState extends ConsumerState<_ZoneView> {
  List<PantryItem> _items = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final items = await ref.read(pantryRepoProvider).byZone(widget.zone);
    if (!mounted) return;
    setState(() {
      _items = items;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final now = DateTime.now();
    final label = _kitchenZoneLabel(widget.zone);

    return Scaffold(
      key: const Key('kitchen-zone-view'),
      backgroundColor: colors.canvas,
      appBar: AppBar(
        title: Text(label),
        backgroundColor: colors.canvas,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
      ),
      body: _loading
          ? const SizedBox.shrink()
          : _items.isEmpty
              // Honest empty state — the zone genuinely has no items.
              ? Center(
                  child: Padding(
                    padding: AppSpacing.pagePadding,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          _zoneIcon(widget.zone),
                          size: 40,
                          color: colors.textSecondary,
                        ),
                        AppSpacing.gapV4,
                        Text(
                          '$label is empty',
                          key: const Key('kitchen-zone-empty'),
                          style: text.titleMedium
                              ?.copyWith(color: colors.textSecondary),
                        ),
                      ],
                    ),
                  ),
                )
              // A finite entrance (base duration, no repeat) — alive but
              // test-friendly: pumpAndSettle completes.
              : TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: 1),
                  duration: AppMotion.base,
                  curve: AppMotion.enter,
                  builder: (context, t, child) => Opacity(
                    opacity: t,
                    child: Transform.translate(
                      offset: Offset(0, (1 - t) * 12),
                      child: child,
                    ),
                  ),
                  child: ListView(
                    padding: AppSpacing.pagePadding,
                    children: [
                      StatCard(
                        padding: EdgeInsets.zero,
                        child: Column(
                          children: [
                            for (var i = 0; i < _items.length; i++) ...[
                              if (i > 0)
                                Divider(
                                  height: 1,
                                  thickness: 1,
                                  color: colors.hairline,
                                ),
                              _PantryItemTile(
                                item: _items[i],
                                freshness: freshnessOf(_items[i], now),
                                onTap: () => widget.onShowDetail(_items[i]),
                                onEdit: () async {
                                  await widget.onEdit(_items[i]);
                                  await _load();
                                },
                                onDelete: () async {
                                  await widget.onDelete(_items[i].id);
                                  await _load();
                                },
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
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
