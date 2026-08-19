import 'package:flutter/material.dart';

class FoodPage extends StatelessWidget {
  const FoodPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      key: Key('food-page'),
      body: Center(child: Text('Food')),
    );
  }
}
