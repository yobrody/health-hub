import 'package:flutter/material.dart';

import 'nav/root_scaffold.dart';

/// Root application widget.
class HealthHubApp extends StatelessWidget {
  const HealthHubApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Health Hub',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
        useMaterial3: true,
      ),
      home: const RootScaffold(),
    );
  }
}
