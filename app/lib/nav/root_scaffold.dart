import 'package:flutter/material.dart';

import '../pages/food_page.dart';
import '../pages/gym_page.dart';
import '../pages/nutrition_page.dart';
import '../pages/settings_page.dart';
import '../pages/today_page.dart';

/// Root navigation shell: a bottom [NavigationBar] of 5 destinations
/// switching an [IndexedStack] of placeholder pages.
class RootScaffold extends StatefulWidget {
  const RootScaffold({super.key});

  @override
  State<RootScaffold> createState() => _RootScaffoldState();
}

class _RootScaffoldState extends State<RootScaffold> {
  int _selectedIndex = 0;

  static const List<Widget> _pages = [
    TodayPage(),
    FoodPage(),
    GymPage(),
    NutritionPage(),
    SettingsPage(),
  ];

  static const List<NavigationDestination> _destinations = [
    NavigationDestination(icon: Icon(Icons.today), label: 'Today'),
    NavigationDestination(icon: Icon(Icons.restaurant), label: 'Food'),
    NavigationDestination(icon: Icon(Icons.fitness_center), label: 'Gym'),
    NavigationDestination(icon: Icon(Icons.pie_chart), label: 'Nutrition'),
    NavigationDestination(icon: Icon(Icons.settings), label: 'Settings'),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: _pages,
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
