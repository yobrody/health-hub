// Unit tests for the R-2 recognition models + fake client.
//
// Honesty invariants covered:
//  • RecognizedItem / RecognitionResult JSON round-trip; null qty/unit are
//    OMITTED from JSON (never fabricated as 0/"").
//  • confidence is clamped into [0,1] (a malformed value can't render >100%).
//  • qty/unit stay null when absent.
//  • The Supabase real client is NEVER instantiated here — only the fake.

import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/pantry/pantry_item.dart';
import 'package:health_hub/pantry/recognition/pantry_recognition.dart';
import 'package:health_hub/pantry/recognition/recognition_client.dart';

void main() {
  group('RecognizedItem', () {
    test('round-trips through JSON with all fields', () {
      const item = RecognizedItem(
        name: 'Milk',
        zoneGuess: PantryZone.fridge,
        confidence: 0.9,
        qtyGuess: 2,
        unitGuess: 'L',
      );
      final back = RecognizedItem.fromJson(item.toJson());
      expect(back.name, 'Milk');
      expect(back.zoneGuess, PantryZone.fridge);
      expect(back.confidence, 0.9);
      expect(back.qtyGuess, 2);
      expect(back.unitGuess, 'L');
    });

    test('null qty/unit are OMITTED from JSON (never fabricated)', () {
      const item = RecognizedItem(
        name: 'Salt',
        zoneGuess: PantryZone.condiments,
        confidence: 0.5,
      );
      final json = item.toJson();
      expect(json.containsKey('qtyGuess'), isFalse);
      expect(json.containsKey('unitGuess'), isFalse);

      final back = RecognizedItem.fromJson(json);
      expect(back.qtyGuess, isNull);
      expect(back.unitGuess, isNull);
    });

    test('confidence is clamped into [0,1]', () {
      final high = RecognizedItem.fromJson({
        'name': 'X',
        'zoneGuess': 'pantry',
        'confidence': 4.2,
      });
      final low = RecognizedItem.fromJson({
        'name': 'Y',
        'zoneGuess': 'pantry',
        'confidence': -3,
      });
      expect(high.confidence, 1.0);
      expect(low.confidence, 0.0);
    });

    test('unknown zone string defaults to pantry (safe, non-perishable)', () {
      final item = RecognizedItem.fromJson({
        'name': 'Mystery',
        'zoneGuess': 'garage',
        'confidence': 0.6,
      });
      expect(item.zoneGuess, PantryZone.pantry);
    });

    test('blank unit string parses to null (not "")', () {
      final item = RecognizedItem.fromJson({
        'name': 'Rice',
        'zoneGuess': 'pantry',
        'confidence': 0.7,
        'qtyGuess': 1,
        'unitGuess': '  ',
      });
      expect(item.unitGuess, isNull);
    });
  });

  group('RecognitionResult', () {
    test('round-trips a list of items', () {
      const result = RecognitionResult(items: [
        RecognizedItem(
            name: 'Eggs', zoneGuess: PantryZone.fridge, confidence: 0.8),
        RecognizedItem(
            name: 'Flour', zoneGuess: PantryZone.pantry, confidence: 0.6),
      ]);
      final back = RecognitionResult.fromJson(result.toJson());
      expect(back.items.length, 2);
      expect(back.items[0].name, 'Eggs');
      expect(back.items[1].zoneGuess, PantryZone.pantry);
    });

    test('malformed / missing items yields empty (honest, no fabrication)', () {
      expect(RecognitionResult.fromJson({}).items, isEmpty);
      expect(RecognitionResult.fromJson({'items': 'nope'}).items, isEmpty);
    });

    test('nameless rows are dropped (not real suggestions)', () {
      final result = RecognitionResult.fromJson({
        'items': [
          {'name': '', 'zoneGuess': 'fridge', 'confidence': 0.9},
          {'name': 'Butter', 'zoneGuess': 'fridge', 'confidence': 0.9},
        ],
      });
      expect(result.items.length, 1);
      expect(result.items.single.name, 'Butter');
    });
  });

  group('FakePantryRecognitionClient', () {
    test('returns its canned result and records the images', () async {
      const result = RecognitionResult(items: [
        RecognizedItem(
            name: 'Milk', zoneGuess: PantryZone.fridge, confidence: 0.9),
      ]);
      final client = FakePantryRecognitionClient(result: result);
      final images = [Uint8List.fromList([1, 2, 3])];

      final out = await client.recognize(images);
      expect(out.items.single.name, 'Milk');
      expect(client.lastImages, same(images));
    });

    test('throws its canned error when set (drives the honest error path)',
        () async {
      final client = FakePantryRecognitionClient(
        error: const RecognitionFailure('boom'),
      );
      expect(
        () => client.recognize([Uint8List(0)]),
        throwsA(isA<RecognitionFailure>()),
      );
    });
  });
}
