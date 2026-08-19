import 'package:flutter/material.dart';

class TodayPage extends StatelessWidget {
  const TodayPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      key: Key('today-page'),
      body: Center(child: Text('Today')),
    );
  }
}
