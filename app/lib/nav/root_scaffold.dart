import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_providers.dart';
import '../pages/cart_page.dart';
import '../pages/food_page.dart';
import '../pages/gym_page.dart';
import '../pages/today_page.dart';
import '../sync/sync_status_banner.dart';

/// Root navigation shell: a bottom [NavigationBar] of 4 destinations
/// (Home · Food · Gym · Cart) switching an [IndexedStack] of feature pages.
///
/// Settings and meal-logging (Nutrition) are deliberately NOT tabs (R-1
/// restructure): Settings is reached via a gear button top-LEFT of Home, and
/// "Log a meal" is a prominent Home action that pushes NutritionPage as a route.
/// Both remain fully reachable — just not on the bottom bar.
///
/// R-5: The Cart destination shows a live [Badge] when the grocery list has
/// items. The badge count animates in/out using [AnimatedSwitcher] (finite,
/// always settles) — [Badge.count] is only visible when count > 0.
class RootScaffold extends ConsumerStatefulWidget {
  const RootScaffold({super.key});

  @override
  ConsumerState<RootScaffold> createState() => _RootScaffoldState();
}

class _RootScaffoldState extends ConsumerState<RootScaffold> {
  int _selectedIndex = 0;
  int _cartCount = 0;

  /// Tab indices — used by the home cross-links (pantry-glance, restock, and the
  /// Brain's insight actions) to jump straight to the right tab.
  static const int _foodTabIndex = 1;
  static const int _gymTabIndex = 2;
  static const int _cartTabIndex = 3;

  void _goToTab(int index) {
    setState(() => _selectedIndex = index);
    if (index == _cartTabIndex) _reloadCartCount();
  }

  late final List<Widget> _pages = [
    TodayPage(
      onOpenPantry: () => _goToTab(_foodTabIndex),
      onOpenGym: () => _goToTab(_gymTabIndex),
      onOpenCart: () => _goToTab(_cartTabIndex),
    ),
    const FoodPage(),
    const GymPage(),
    const CartPage(),
  ];

  @override
  void initState() {
    super.initState();
    _reloadCartCount();
  }

  Future<void> _reloadCartCount() async {
    final repo = ref.read(groceryListRepoProvider);
    final items = await repo.all();
    if (!mounted) return;
    setState(() => _cartCount = items.length);
  }

  List<NavigationDestination> _buildDestinations() {
    return [
      const NavigationDestination(
          icon: Icon(Icons.home_outlined), label: 'Home'),
      const NavigationDestination(
          icon: Icon(Icons.restaurant), label: 'Food'),
      const NavigationDestination(
          icon: Icon(Icons.fitness_center), label: 'Gym'),
      NavigationDestination(
        icon: AnimatedSwitcher(
          duration: const Duration(milliseconds: 200),
          child: Badge.count(
            key: ValueKey(_cartCount > 0),
            count: _cartCount,
            isLabelVisible: _cartCount > 0,
            child: const Icon(Icons.shopping_cart_outlined),
          ),
        ),
        label: 'Cart',
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          Expanded(
            child: IndexedStack(
              index: _selectedIndex,
              children: _pages,
            ),
          ),
          // The honest, app-wide sync indicator. Renders nothing when synced;
          // "Syncing…" when writes are queued; a "couldn't sync" warning with a
          // Try-again when writes failed. Sits just above the nav bar.
          const SafeArea(
            top: false,
            child: SyncStatusBanner(),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) {
          setState(() => _selectedIndex = index);
          // Refresh cart count when the user switches tabs — keeps the badge
          // live without a full Riverpod watch (the list is local-only for now).
          if (index == 3) _reloadCartCount();
        },
        destinations: _buildDestinations(),
      ),
    );
  }
}
