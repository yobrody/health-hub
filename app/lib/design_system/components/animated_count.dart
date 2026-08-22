import 'package:flutter/material.dart';

import '../motion.dart';

/// A drop-in [Text] replacement that cross-fades when [value] changes.
///
/// Uses [AnimatedSwitcher] (finite, always settles) so `pumpAndSettle` works in
/// tests. Respects `MediaQuery.disableAnimations` — when set the value renders
/// as a plain [Text] with no animation widget overhead.
class AnimatedCount extends StatelessWidget {
  const AnimatedCount({
    super.key,
    required this.value,
    required this.keySuffix,
    this.style,
  });

  final int value;
  final String keySuffix;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final noAnim = MediaQuery.of(context).disableAnimations;
    if (noAnim) {
      return Text(
        '$value',
        key: Key('animated-count-$keySuffix'),
        style: style,
      );
    }
    return AnimatedSwitcher(
      duration: AppMotion.fast,
      switchInCurve: AppMotion.standard,
      switchOutCurve: AppMotion.standard,
      child: Text(
        '$value',
        key: Key('animated-count-$keySuffix-$value'),
        style: style,
      ),
    );
  }
}
