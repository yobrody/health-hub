import 'package:flutter/material.dart';

class GymPage extends StatelessWidget {
  const GymPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      key: Key('gym-page'),
      body: Center(child: Text('Gym')),
    );
  }
}
