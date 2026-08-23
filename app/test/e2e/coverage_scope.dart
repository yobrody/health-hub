// Shared seam-fakes + override helpers for the EXHAUSTIVE coverage tests.
//
// `journey_scope.dart`'s [JourneyHarness] wires the DATA repos (goals, food,
// pantry, workouts, weigh-ins, grocery, kitchen, profile) to shared in-memory
// stores + a signed-in fake auth + a silent connectivity monitor. That's the
// interconnection backbone.
//
// The coverage tests additionally drive the app's outward SEAMS — the barcode
// lookup, the AI photo recognizer, the grocery link launcher, the Instacart
// pre-filled-cart client, the device location, and the offline outbox / sync
// banner. Those seams are NOT overridden by [JourneyHarness] (they default to
// real network/camera/GPS/Supabase clients), so this file provides in-memory
// fakes + a `coverageOverrides(...)` that layers them on top of the harness's
// data overrides. Everything stays deterministic + headless — no network, no
// camera, no GPS, no Supabase, no real SharedPreferences.

import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:health_hub/app_providers.dart';
import 'package:health_hub/cart/instacart_client.dart';
import 'package:health_hub/cart/link_launcher.dart';
import 'package:health_hub/cart/location_service.dart';
import 'package:health_hub/nutrition/off_client.dart';
import 'package:health_hub/nutrition/packaged_food_model.dart';
import 'package:health_hub/offline/outbox.dart';
import 'package:health_hub/offline/outbox_store.dart';
import 'package:health_hub/offline/pending_mutation.dart';
import 'package:health_hub/pantry/recognition/pantry_recognition.dart';
import 'package:health_hub/pantry/recognition/recognition_client.dart';

import 'journey_scope.dart';

// ── Barcode seam (Open Food Facts) ───────────────────────────────────────────

/// A stub [OffClient] that returns a fixed [PackagedFood?] without any Dio /
/// network. Mirrors `nutrition_page_test.dart`'s `_StubOffClient`.
class StubOffClient extends OffClient {
  StubOffClient(this.food) : super(Dio());
  final PackagedFood? food;
  @override
  Future<PackagedFood?> lookupBarcode(String code) async => food;
}

// ── AI-photo recognition seam ────────────────────────────────────────────────
//
// Reuses the app's own [FakePantryRecognitionClient] (canned result OR a thrown
// failure) — see recognition_client.dart. Exported here for convenience.

// ── Grocery link launcher seam ───────────────────────────────────────────────

/// Records launched URIs instead of opening a browser.
class FakeLinkLauncher implements LinkLauncher {
  final List<Uri> launched = [];
  @override
  Future<void> launch(Uri uri) async => launched.add(uri);
}

// ── Location seam ─────────────────────────────────────────────────────────────

/// Returns a preset [LocationResult] (success OR a denial) with no GPS.
class FakeLocationService implements LocationService {
  FakeLocationService(this.result);
  final LocationResult result;
  @override
  Future<LocationResult> getLocation() async => result;
}

// ── Offline outbox (in-memory, seedable) ─────────────────────────────────────

/// A trivial in-memory [OutboxStore] so a coverage test can build a real
/// [Outbox] and drive the sync banner's pending/failed states deterministically
/// — without any SharedPreferences.
class MemOutboxStore implements OutboxStore {
  MemOutboxStore([List<PendingMutation>? seed]) : _i = seed ?? [];
  List<PendingMutation> _i;
  @override
  Future<List<PendingMutation>> load() async => List.unmodifiable(_i);
  @override
  Future<void> save(List<PendingMutation> items) async => _i = List.of(items);
}

/// A PendingMutation for seeding the outbox in a state test.
PendingMutation samplePending(String id) => PendingMutation(
      id: id,
      dedupeKey: id,
      method: 'PUT',
      path: '/tdee/profile',
      body: const {'weight_kg': 70},
      createdAt: 0,
    );

// ── Override composition ─────────────────────────────────────────────────────

/// The full override set for a coverage test: the harness's data overrides PLUS
/// any provided seam fakes. Only the seams a test actually exercises need to be
/// passed; the rest keep their (real) defaults, which the test simply won't hit.
///
/// [outbox] lets a test inject a seeded [Outbox] so the app-wide sync banner
/// renders a real pending/failed state (the harness's default outbox stays
/// empty → the banner is silent).
List<Override> coverageOverrides(
  JourneyHarness h, {
  OffClient? offClient,
  PantryRecognitionClient? recognitionClient,
  LinkLauncher? linkLauncher,
  LocationService? locationService,
  InstacartClient? instacartClient,
  Outbox? outbox,
}) {
  return [
    ...h.overrides,
    if (offClient != null) offClientProvider.overrideWithValue(offClient),
    if (recognitionClient != null)
      pantryRecognitionClientProvider.overrideWithValue(recognitionClient),
    if (instacartClient != null)
      instacartClientProvider.overrideWithValue(instacartClient),
    if (outbox != null) outboxProvider.overrideWithValue(outbox),
  ];
}

/// A 1×1 fake image byte buffer to feed the recognition seam (bytes are never
/// decoded by the fake — it just forwards them).
Uint8List fakeImageBytes() => Uint8List.fromList([1, 2, 3, 4]);

/// A tiny [RecognitionResult] with one high-confidence item, for the AI-photo
/// confirm-before-save flow.
RecognitionResult oneRecognizedItem(String name) => RecognitionResult(
      items: [
        RecognizedItem(
          name: name,
          zoneGuess: recognizedZoneFromString('fridge'),
          confidence: 0.9,
        ),
      ],
    );
