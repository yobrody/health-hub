import 'package:flutter/material.dart';

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
class RootScaffold extends StatefulWidget {
  const RootScaffold({super.key});

  @override
  State<RootScaffold> createState() => _RootScaffoldState();
}

class _RootScaffoldState extends State<RootScaffold> {
  int _selectedIndex = 0;

  /// The Food (Fridge & Pantry) tab index — used by the home pantry-glance and
  /// restock-soon cross-links to jump straight to the pantry.
  static const int _foodTabIndex = 1;

  late final List<Widget> _pages = [
    TodayPage(onOpenPantry: () => setState(() => _selectedIndex = _foodTabIndex)),
    const FoodPage(),
    const GymPage(),
    const CartPage(),
  ];

  static const List<NavigationDestination> _destinations = [
    NavigationDestination(icon: Icon(Icons.home_outlined), label: 'Home'),
    NavigationDestination(icon: Icon(Icons.restaurant), label: 'Food'),
    NavigationDestination(icon: Icon(Icons.fitness_center), label: 'Gym'),
    NavigationDestination(
        icon: Icon(Icons.shopping_cart_outlined), label: 'Cart'),
  ];

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
        },
        destinations: _destinations,
      ),
    );
  }
}
