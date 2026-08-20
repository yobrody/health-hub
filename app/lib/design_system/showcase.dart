import 'package:flutter/material.dart';

import 'colors.dart';
import 'shape.dart';
import 'spacing.dart';
import 'typography.dart';

/// A visual QA + golden-test surface for the design system. Renders the palette
/// swatches, the type ramp, buttons, a card, and chips under whatever theme it's
/// pumped in. NOT wired into app navigation — it's a design-system artifact.
///
/// Pump it under `MaterialApp(theme: lightTheme)` / `darkTheme` to eyeball both
/// moods, and it doubles as a golden-test target.
class DesignShowcase extends StatelessWidget {
  const DesignShowcase({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Design System')),
      body: ListView(
        padding: AppSpacing.pagePadding,
        children: [
          // ── Hero number (editorial serif) ────────────────────────────────
          Text('Today', style: text.titleMedium),
          Text(
            '62.5',
            style: AppTypography.heroNumber(color: colors.primaryStrong),
          ),
          Text('kg · on track', style: text.bodySmall),
          AppSpacing.gapV8,

          // ── Palette swatches ─────────────────────────────────────────────
          Text('Palette', style: text.headlineSmall),
          AppSpacing.gapV4,
          Wrap(
            spacing: AppSpacing.space3,
            runSpacing: AppSpacing.space3,
            children: [
              _Swatch('canvas', colors.canvas),
              _Swatch('surface', colors.surface),
              _Swatch('surfaceWarm', colors.surfaceWarm),
              _Swatch('primary', colors.primary),
              _Swatch('primaryStrong', colors.primaryStrong),
              _Swatch('accent', colors.accent),
              _Swatch('textPrimary', colors.textPrimary),
              _Swatch('textSecondary', colors.textSecondary),
              _Swatch('hairline', colors.hairline),
            ],
          ),
          AppSpacing.gapV8,

          // ── Type ramp ────────────────────────────────────────────────────
          Text('Type', style: text.headlineSmall),
          AppSpacing.gapV4,
          Text('Display L', style: text.displaySmall),
          Text('Headline M', style: text.headlineMedium),
          Text('Title L', style: text.titleLarge),
          Text('Title M', style: text.titleMedium),
          Text(
            'Body L — a calm, warm, honest health app. Generous line-height '
            'keeps long copy comfortable to read.',
            style: text.bodyLarge,
          ),
          Text(
            'Body M — supporting copy sits a touch quieter.',
            style: text.bodyMedium,
          ),
          Text('LABEL SMALL', style: text.labelSmall),
          AppSpacing.gapV8,

          // ── Buttons ──────────────────────────────────────────────────────
          Text('Buttons', style: text.headlineSmall),
          AppSpacing.gapV4,
          Wrap(
            spacing: AppSpacing.space3,
            runSpacing: AppSpacing.space3,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              FilledButton(onPressed: () {}, child: const Text('Log weight')),
              OutlinedButton(onPressed: () {}, child: const Text('Skip')),
              TextButton(onPressed: () {}, child: const Text('Learn more')),
            ],
          ),
          AppSpacing.gapV8,

          // ── Card ─────────────────────────────────────────────────────────
          Text('Card', style: text.headlineSmall),
          AppSpacing.gapV4,
          Card(
            child: Padding(
              padding: AppSpacing.cardInsets,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Readiness', style: text.titleMedium),
                  AppSpacing.gapV1,
                  Text('84', style: text.displaySmall),
                  Text('Well recovered — go a little harder today.',
                      style: text.bodySmall),
                ],
              ),
            ),
          ),
          AppSpacing.gapV8,

          // ── Chips ────────────────────────────────────────────────────────
          Text('Chips', style: text.headlineSmall),
          AppSpacing.gapV4,
          Wrap(
            spacing: AppSpacing.space2,
            runSpacing: AppSpacing.space2,
            children: [
              const Chip(label: Text('Protein')),
              const Chip(label: Text('Carbs')),
              FilterChip(
                label: const Text('High protein'),
                selected: true,
                onSelected: (_) {},
              ),
              FilterChip(
                label: const Text('Vegetarian'),
                selected: false,
                onSelected: (_) {},
              ),
            ],
          ),
          AppSpacing.gapV6,
        ],
      ),
    );
  }
}

/// A single labelled colour chip.
class _Swatch extends StatelessWidget {
  const _Swatch(this.name, this.color);

  final String name;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    return SizedBox(
      width: 96,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: 56,
            decoration: BoxDecoration(
              color: color,
              borderRadius: AppShape.button,
              border: Border.all(color: colors.hairline),
            ),
          ),
          AppSpacing.gapV1,
          Text(name, style: Theme.of(context).textTheme.labelSmall),
        ],
      ),
    );
  }
}
