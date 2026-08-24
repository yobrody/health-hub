/// Weight detail page — weigh-in trend chart + history list + log-weight action.
///
/// **Honesty is load-bearing here.** The chart only draws real data:
///  * ≥2 real weigh-ins (non-null [WeighIn.weightKg]) → line chart from the
///    real points, oldest-left to newest-right.
///  * Exactly 1 real weigh-in → a single dot + "Log another to see your trend".
///  * 0 real weigh-ins → "No weigh-ins yet" empty state.
///  * A null-weight weigh-in (placeholder/imported) is EXCLUDED from the plot.
///  * The goal line is drawn ONLY when a real [Profile.targetWeightKg] is set.
///    Never a fabricated 72 kg.
///
/// The chart uses [CustomPaint] — no extra package, no animation that could
/// block [pumpAndSettle] in tests.
library;

import 'package:flutter/material.dart';

import '../analytics/analytics.dart';
import '../design_system/colors.dart';
import '../design_system/components/section_header.dart';
import '../design_system/components/stat_card.dart';
import '../design_system/spacing.dart';
import '../metrics/weigh_in.dart';
import '../metrics/weigh_in_repo.dart';
import '../metrics/weight_trend.dart';
import '../profile/profile_model.dart';
import '../profile/profile_repo.dart';
import '../widgets/log_weight_sheet.dart';

/// The weight detail screen — push it from [TodayPage] (or any route).
///
/// Accepts constructor-injected repos so widget tests can drive it with
/// in-memory fakes without a ProviderScope (same pattern as [TodayPage]).
class WeightPage extends StatefulWidget {
  const WeightPage({
    super.key,
    required this.weighInRepo,
    required this.profileRepo,
    this.analytics = const NoopAnalytics(),
  });

  final WeighInRepo weighInRepo;
  final ProfileRepo profileRepo;

  /// Analytics seam — [NoopAnalytics] by default so tests are unaffected.
  final Analytics analytics;

  @override
  State<WeightPage> createState() => _WeightPageState();
}

class _WeightPageState extends State<WeightPage> {
  List<WeighIn> _history = const [];
  Profile _profile = const Profile();
  WeightTrend _trend = WeightTrend.none;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final history = await widget.weighInRepo.all();
    final profile = await widget.profileRepo.load();
    if (!mounted) return;
    setState(() {
      _history = history;
      _profile = profile;
      _trend = computeWeightTrend(history);
      _loading = false;
    });
  }

  Future<void> _logWeight() async {
    final saved = await showLogWeightSheet(
      context,
      repo: widget.weighInRepo,
      analytics: widget.analytics,
    );
    if (saved == true) await _reload();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: const Key('weight-page'),
      appBar: AppBar(
        title: const Text('Weight'),
        centerTitle: false,
      ),
      body: _loading
          ? const SizedBox.shrink()
          : SafeArea(
              child: ListView(
                padding: AppSpacing.pagePadding,
                children: [
                  SectionHeader(
                    title: 'TREND',
                    trailing: TextButton(
                      key: const Key('weight-page-log-btn'),
                      onPressed: _logWeight,
                      child: const Text('Log weight'),
                    ),
                  ),
                  _ChartCard(
                    history: _history,
                    targetWeightKg: _profile.targetWeightKg,
                    trend: _trend,
                  ),
                  AppSpacing.gapV8,

                  const SectionHeader(title: 'HISTORY'),
                  _HistoryList(history: _history),
                  AppSpacing.gapV8,
                ],
              ),
            ),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('weight-page-fab'),
        onPressed: _logWeight,
        icon: const Icon(Icons.add),
        label: const Text('Log weight'),
      ),
    );
  }
}

// ── Chart card ────────────────────────────────────────────────────────────────

/// Routes to the correct honest-state widget based on the number of real
/// (non-null weight) weigh-ins.
class _ChartCard extends StatelessWidget {
  const _ChartCard({
    required this.history,
    required this.targetWeightKg,
    required this.trend,
  });

  final List<WeighIn> history;
  final double? targetWeightKg;
  final WeightTrend trend;

  @override
  Widget build(BuildContext context) {
    // Only REAL readings (non-null weight) participate in the chart.
    final real = history.where((w) => w.weightKg != null).toList()
      ..sort((a, b) => a.at.compareTo(b.at));

    if (real.isEmpty) {
      return const _EmptyState();
    }
    if (real.length == 1) {
      return _SinglePointState(weighIn: real.first);
    }
    return _LineChartState(
      points: real,
      targetWeightKg: targetWeightKg,
      trend: trend,
    );
  }
}

// ── 0-readings: honest empty state ──────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    return StatCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.monitor_weight_outlined,
              size: 32, color: colors.textSecondary),
          AppSpacing.gapV4,
          Text(
            'No weigh-ins yet — log your first',
            key: const Key('weight-empty-message'),
            style: text.titleMedium,
          ),
          AppSpacing.gapV2,
          Text(
            'Every reading is anchored to now — we never guess.',
            style: text.bodyMedium?.copyWith(color: colors.textSecondary),
          ),
        ],
      ),
    );
  }
}

// ── 1-reading: single point with "log another" nudge ───────────────────────

class _SinglePointState extends StatelessWidget {
  const _SinglePointState({required this.weighIn});

  final WeighIn weighIn;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final kg = weighIn.weightKg!; // non-null — callers guarantee it.

    return StatCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Single dot visual — a 12 px dot on a horizontal hairline.
          SizedBox(
            height: 72,
            child: CustomPaint(
              painter: _SingleDotPainter(
                dotColor: colors.primary,
                lineColor: colors.hairline,
              ),
            ),
          ),
          AppSpacing.gapV4,
          Text(
            '${formatKg(kg)} kg',
            style: text.titleLarge,
          ),
          AppSpacing.gapV1,
          Text(
            'Log another to see your trend',
            key: const Key('weight-single-message'),
            style: text.bodyMedium?.copyWith(color: colors.textSecondary),
          ),
        ],
      ),
    );
  }
}

/// Paints a single centred dot on a hairline — the "only one reading" state.
class _SingleDotPainter extends CustomPainter {
  const _SingleDotPainter({required this.dotColor, required this.lineColor});

  final Color dotColor;
  final Color lineColor;

  @override
  void paint(Canvas canvas, Size size) {
    final linePaint = Paint()
      ..color = lineColor
      ..strokeWidth = 1;
    final dotPaint = Paint()..color = dotColor;

    final midY = size.height / 2;
    canvas.drawLine(Offset(0, midY), Offset(size.width, midY), linePaint);
    canvas.drawCircle(Offset(size.width / 2, midY), 6, dotPaint);
  }

  @override
  bool shouldRepaint(_SingleDotPainter old) =>
      old.dotColor != dotColor || old.lineColor != lineColor;
}

// ── ≥2 readings: real line chart ────────────────────────────────────────────

class _LineChartState extends StatelessWidget {
  const _LineChartState({
    required this.points,
    required this.targetWeightKg,
    required this.trend,
  });

  final List<WeighIn> points; // sorted oldest→newest, all have non-null weight
  final double? targetWeightKg;
  final WeightTrend trend;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;

    final currentKg = trend.currentKg!; // non-null — ≥2 real readings.

    return StatCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 180,
            child: WeightLineChart(
              key: const Key('weight-line-chart'),
              points: points,
              targetWeightKg: targetWeightKg,
              lineColor: colors.primaryStrong,
              dotColor: colors.primary,
              goalColor: colors.accent,
              gridColor: colors.hairline,
            ),
          ),
          AppSpacing.gapV4,

          // Current + trend summary.
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${formatKg(currentKg)} kg',
                    style: text.titleLarge,
                  ),
                  AppSpacing.gapV1,
                  Text(
                    'Current weight',
                    style: text.bodySmall?.copyWith(color: colors.textSecondary),
                  ),
                ],
              ),
              if (trend.hasTrend) ...[
                AppSpacing.gapH4,
                _TrendSummary(trend: trend),
              ],
            ],
          ),

          // Goal line legend — only when a REAL goal is set. Never fabricated.
          if (targetWeightKg != null) ...[
            AppSpacing.gapV3,
            Row(
              children: [
                Container(
                  width: 16,
                  height: 2,
                  color: colors.accent,
                ),
                AppSpacing.gapH2,
                Text(
                  'Goal: ${formatKg(targetWeightKg!)} kg',
                  key: const Key('weight-goal-line-legend'),
                  style: text.bodySmall?.copyWith(color: colors.textSecondary),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// The real line chart as a [StatelessWidget] wrapping [CustomPaint].
///
/// Using a [StatelessWidget] (not a bare [CustomPaint]) makes the [Key] work
/// as a reliable widget-test finder. There are no animations — [pumpAndSettle]
/// completes instantly.
class WeightLineChart extends StatelessWidget {
  const WeightLineChart({
    super.key,
    required this.points,
    required this.targetWeightKg,
    required this.lineColor,
    required this.dotColor,
    required this.goalColor,
    required this.gridColor,
  });

  final List<WeighIn> points;
  final double? targetWeightKg;
  final Color lineColor;
  final Color dotColor;
  final Color goalColor;
  final Color gridColor;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _WeightChartPainter(
        points: points,
        targetWeightKg: targetWeightKg,
        lineColor: lineColor,
        dotColor: dotColor,
        goalColor: goalColor,
        gridColor: gridColor,
      ),
      child: const SizedBox.expand(),
    );
  }
}

class _WeightChartPainter extends CustomPainter {
  const _WeightChartPainter({
    required this.points,
    required this.targetWeightKg,
    required this.lineColor,
    required this.dotColor,
    required this.goalColor,
    required this.gridColor,
  });

  final List<WeighIn> points;
  final double? targetWeightKg;
  final Color lineColor;
  final Color dotColor;
  final Color goalColor;
  final Color gridColor;

  @override
  void paint(Canvas canvas, Size size) {
    if (points.isEmpty) return;

    final weights = points.map((w) => w.weightKg!).toList();
    double minW = weights.reduce((a, b) => a < b ? a : b);
    double maxW = weights.reduce((a, b) => a > b ? a : b);
    if (targetWeightKg != null) {
      if (targetWeightKg! < minW) minW = targetWeightKg!;
      if (targetWeightKg! > maxW) maxW = targetWeightKg!;
    }

    final range = maxW - minW;
    final pad = range == 0 ? 2.0 : range * 0.15;
    final yMin = minW - pad;
    final yMax = maxW + pad;
    final yRange = yMax - yMin;

    double toX(int i) =>
        points.length == 1 ? size.width / 2 : size.width * i / (points.length - 1);
    double toY(double kg) => size.height * (1 - (kg - yMin) / yRange);

    // Subtle grid lines.
    final gridPaint = Paint()
      ..color = gridColor
      ..strokeWidth = 0.5;
    for (var i = 0; i <= 2; i++) {
      final y = size.height * i / 2;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    // Dashed goal line — only when a REAL target is set.
    if (targetWeightKg != null) {
      final goalPaint = Paint()
        ..color = goalColor
        ..strokeWidth = 1.5
        ..style = PaintingStyle.stroke;
      final y = toY(targetWeightKg!);
      const dashLen = 8.0;
      const gapLen = 5.0;
      var x = 0.0;
      while (x < size.width) {
        final end = (x + dashLen).clamp(0.0, size.width);
        canvas.drawLine(Offset(x, y), Offset(end, y), goalPaint);
        x += dashLen + gapLen;
      }
    }

    // Data line.
    final linePaint = Paint()
      ..color = lineColor
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final path = Path()..moveTo(toX(0), toY(points[0].weightKg!));
    for (var i = 1; i < points.length; i++) {
      path.lineTo(toX(i), toY(points[i].weightKg!));
    }
    canvas.drawPath(path, linePaint);

    // Dots on each data point.
    final dotBg = Paint()..color = Colors.white;
    final dotFg = Paint()..color = dotColor;
    for (var i = 0; i < points.length; i++) {
      final c = Offset(toX(i), toY(points[i].weightKg!));
      canvas.drawCircle(c, 5, dotBg);
      canvas.drawCircle(c, 4, dotFg);
    }
  }

  @override
  bool shouldRepaint(_WeightChartPainter old) =>
      old.points != points ||
      old.targetWeightKg != targetWeightKg ||
      old.lineColor != lineColor;
}

// ── Trend summary chip ────────────────────────────────────────────────────────

class _TrendSummary extends StatelessWidget {
  const _TrendSummary({required this.trend});

  final WeightTrend trend;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    // Only built inside `if (trend.hasTrend)` — delta is non-null.
    final delta = trend.deltaKg!;

    final (IconData icon, Color color) = switch (trend.direction) {
      TrendDirection.down => (Icons.arrow_downward, colors.accent),
      TrendDirection.up => (Icons.arrow_upward, colors.primaryStrong),
      _ => (Icons.remove, colors.textSecondary),
    };

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 2),
        Text(
          '${formatKg(delta.abs())} kg since first',
          style: text.bodySmall?.copyWith(color: color),
        ),
      ],
    );
  }
}

// ── History list ──────────────────────────────────────────────────────────────

/// Weigh-in history list, most-recent first. Null-weight readings render `—`.
class _HistoryList extends StatelessWidget {
  const _HistoryList({required this.history});

  final List<WeighIn> history;

  @override
  Widget build(BuildContext context) {
    if (history.isEmpty) {
      final colors = context.appColors;
      final text = Theme.of(context).textTheme;
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.space4),
        child: Text(
          'No readings yet.',
          style: text.bodyMedium?.copyWith(color: colors.textSecondary),
        ),
      );
    }

    final sorted = List.of(history)..sort((a, b) => b.at.compareTo(a.at));

    return StatCard(
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          for (var i = 0; i < sorted.length; i++) ...[
            if (i > 0)
              Divider(height: 1, color: context.appColors.hairline),
            _HistoryRow(weighIn: sorted[i]),
          ],
        ],
      ),
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.weighIn});

  final WeighIn weighIn;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final text = Theme.of(context).textTheme;
    final kg = weighIn.weightKg;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.space5,
        vertical: AppSpacing.space3,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              _dateLabel(weighIn.at),
              style: text.bodyMedium,
            ),
          ),
          // Honest — null weight renders `—`, never a fabricated `0`.
          Text(
            kg != null ? '${formatKg(kg)} kg' : '—',
            style: text.bodyMedium?.copyWith(
              color: kg != null ? colors.textPrimary : colors.textSecondary,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  String _dateLabel(DateTime dt) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[dt.month - 1]} ${dt.day}, ${dt.year}';
  }
}
