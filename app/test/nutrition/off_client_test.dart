import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/nutrition/off_client.dart';
import 'package:health_hub/nutrition/packaged_food_model.dart';
import 'package:mocktail/mocktail.dart';

// ---------------------------------------------------------------------------
// Fakes / mocks — mock `dio` so no real network is ever touched.
// ---------------------------------------------------------------------------

class MockDio extends Mock implements Dio {}

/// A realistic Open Food Facts v2 `product/{code}.json` payload: status 1, a
/// product with `serving_size` and a `nutriments` block. Only SOME nutrients
/// are present (no fibre, no sodium/salt) so the "absent → null" rule is tested.
Map<String, dynamic> _offPayload() => {
      'status': 1,
      'product': {
        'product_name': 'Coca-Cola',
        'brands': 'Coca-Cola',
        'serving_size': '330 ml',
        'nutriments': {
          'energy-kcal_100g': 42.0,
          'proteins_100g': 0.0,
          'carbohydrates_100g': 10.6,
          'fat_100g': 0.0,
          'sugars_100g': 10.6,
          'saturated-fat_100g': 0.0,
          // deliberately NO fiber_100g, NO sodium_100g, NO salt_100g
        },
      },
    };

Response<dynamic> _jsonResponse(dynamic data, {int statusCode = 200}) {
  return Response(
    data: data,
    statusCode: statusCode,
    requestOptions: RequestOptions(path: '/product'),
  );
}

DioException _dioError() => DioException(
      requestOptions: RequestOptions(path: '/product'),
      type: DioExceptionType.connectionError,
    );

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: ''));
    registerFallbackValue(Options());
  });

  late MockDio dio;
  late OffClient client;

  setUp(() {
    dio = MockDio();
    client = OffClient(dio);
  });

  group('OffClient.lookupBarcode — happy path', () {
    test('parses a realistic OFF v2 payload into a PackagedFood', () async {
      when(() => dio.get<dynamic>(any(), options: any(named: 'options')))
          .thenAnswer((_) async => _jsonResponse(_offPayload()));

      final food = await client.lookupBarcode('5449000000996');

      expect(food, isNotNull);
      expect(food!.barcode, '5449000000996');
      expect(food.name, 'Coca-Cola');
      expect(food.brand, 'Coca-Cola');
      // "330 ml" → parseServingGrams treats ml ~1 g/ml.
      expect(food.servingGrams, closeTo(330, 0.001));
      // per-100g values mapped verbatim.
      expect(food.kcalPer100g, 42.0);
      expect(food.proteinPer100g, 0.0);
      expect(food.carbsPer100g, 10.6);
      expect(food.fatPer100g, 0.0);
    });

    test('micros contain ONLY present fields (sugars + sat-fat), not absent', () async {
      when(() => dio.get<dynamic>(any(), options: any(named: 'options')))
          .thenAnswer((_) async => _jsonResponse(_offPayload()));

      final food = await client.lookupBarcode('5449000000996');

      expect(food!.microsPer100g, isNotNull);
      expect(food.microsPer100g!['sugars_g'], 10.6);
      expect(food.microsPer100g!['saturated_fat_g'], 0.0);
      // Absent fibre / sodium / salt → NOT a key (never 0).
      expect(food.microsPer100g!.containsKey('fiber_g'), isFalse);
      expect(food.microsPer100g!.containsKey('sodium_mg'), isFalse);
    });

    test('a nutrient absent in nutriments → null on the model (never 0)', () async {
      // A payload with only energy present.
      when(() => dio.get<dynamic>(any(), options: any(named: 'options')))
          .thenAnswer(
        (_) async => _jsonResponse({
          'status': 1,
          'product': {
            'product_name': 'Mystery',
            'nutriments': {'energy-kcal_100g': 100.0},
          },
        }),
      );

      final food = await client.lookupBarcode('01234567');

      expect(food, isNotNull);
      expect(food!.kcalPer100g, 100.0);
      // Absent macros → null, NOT 0.
      expect(food.proteinPer100g, isNull);
      expect(food.carbsPer100g, isNull);
      expect(food.fatPer100g, isNull);
      // No micros present at all → null map (not {}).
      expect(food.microsPer100g, isNull);
      // No serving_size → null (honest, not a guessed 100 g).
      expect(food.servingGrams, isNull);
    });

    test('derives sodium (mg) from salt (g) when only salt is supplied', () async {
      when(() => dio.get<dynamic>(any(), options: any(named: 'options')))
          .thenAnswer(
        (_) async => _jsonResponse({
          'status': 1,
          'product': {
            'product_name': 'Salted Crisps',
            'nutriments': {
              'energy-kcal_100g': 530.0,
              'salt_100g': 1.5, // no sodium_100g → derive it
            },
          },
        }),
      );

      final food = await client.lookupBarcode('12345678');

      // 1.5 g salt / 2.5 * 1000 = 600 mg sodium.
      expect(food!.microsPer100g!['sodium_mg'], closeTo(600, 0.001));
    });

    test('prefers OFF-supplied sodium_100g over deriving from salt', () async {
      when(() => dio.get<dynamic>(any(), options: any(named: 'options')))
          .thenAnswer(
        (_) async => _jsonResponse({
          'status': 1,
          'product': {
            'product_name': 'Thing',
            'nutriments': {
              'sodium_100g': 0.2, // grams → 200 mg
              'salt_100g': 5.0, // must be ignored when sodium present
            },
          },
        }),
      );

      final food = await client.lookupBarcode('12345678');

      // sodium_100g is in grams; convert to mg (×1000). Salt path NOT used.
      expect(food!.microsPer100g!['sodium_mg'], closeTo(200, 0.001));
    });
  });

  group('OffClient.lookupBarcode — honest no-result cases', () {
    test('status: 0 → null', () async {
      when(() => dio.get<dynamic>(any(), options: any(named: 'options')))
          .thenAnswer((_) async => _jsonResponse({'status': 0}));

      expect(await client.lookupBarcode('5449000000996'), isNull);
    });

    test('missing product (status 1 but no product) → null', () async {
      when(() => dio.get<dynamic>(any(), options: any(named: 'options')))
          .thenAnswer((_) async => _jsonResponse({'status': 1}));

      expect(await client.lookupBarcode('5449000000996'), isNull);
    });

    test('non-numeric barcode → null with NO network call', () async {
      final food = await client.lookupBarcode('abc123');

      expect(food, isNull);
      verifyNever(() => dio.get<dynamic>(any(), options: any(named: 'options')));
    });

    test('empty barcode → null with NO network call', () async {
      final food = await client.lookupBarcode('');

      expect(food, isNull);
      verifyNever(() => dio.get<dynamic>(any(), options: any(named: 'options')));
    });

    test('too-short barcode (<8 digits) → null with NO network call', () async {
      final food = await client.lookupBarcode('1234567');

      expect(food, isNull);
      verifyNever(() => dio.get<dynamic>(any(), options: any(named: 'options')));
    });

    test('too-long barcode (>14 digits) → null with NO network call', () async {
      final food = await client.lookupBarcode('123456789012345');

      expect(food, isNull);
      verifyNever(() => dio.get<dynamic>(any(), options: any(named: 'options')));
    });

    test('a thrown DioException → null (no crash)', () async {
      when(() => dio.get<dynamic>(any(), options: any(named: 'options')))
          .thenThrow(_dioError());

      expect(await client.lookupBarcode('5449000000996'), isNull);
    });

    test('a non-Map body (HTML error page) → null (no crash)', () async {
      when(() => dio.get<dynamic>(any(), options: any(named: 'options')))
          .thenAnswer((_) async => _jsonResponse('<html>oops</html>'));

      expect(await client.lookupBarcode('5449000000996'), isNull);
    });
  });

  group('OffClient request shape', () {
    test('sends a User-Agent header and the v2 product URL', () async {
      when(() => dio.get<dynamic>(any(), options: any(named: 'options')))
          .thenAnswer((_) async => _jsonResponse(_offPayload()));

      await client.lookupBarcode('5449000000996');

      final captured = verify(
        () => dio.get<dynamic>(
          captureAny(),
          options: captureAny(named: 'options'),
        ),
      ).captured;
      final url = captured[0] as String;
      final options = captured[1] as Options;

      expect(url, contains('world.openfoodfacts.org/api/v2/product/'));
      expect(url, contains('5449000000996'));
      expect(options.headers, isNotNull);
      expect(options.headers!['User-Agent'], isNotNull);
      expect((options.headers!['User-Agent'] as String), contains('Health-Hub'));
    });
  });

  group('PackagedFood.toServing — honest scaling', () {
    test('scales per-100g nutrients to a 330 g serving; nulls stay null', () {
      const food = PackagedFood(
        barcode: '5449000000996',
        name: 'Coca-Cola',
        brand: 'Coca-Cola',
        servingGrams: 330,
        kcalPer100g: 42.0,
        proteinPer100g: 0.0,
        carbsPer100g: 10.6,
        fatPer100g: null, // unknown → must stay null after scaling
        microsPer100g: {'sugars_g': 10.6},
      );

      final scaled = food.toServing(330);

      // 42 * 330 / 100 = 138.6
      expect(scaled['kcal'], closeTo(138.6, 0.001));
      expect(scaled['proteinG'], closeTo(0.0, 0.001));
      expect(scaled['carbsG'], closeTo(34.98, 0.001));
      // null per-100g → null scaled (never 0).
      expect(scaled['fatG'], isNull);
      // A micro scales too: 10.6 * 330 / 100 = 34.98
      expect(scaled['sugars_g'], closeTo(34.98, 0.001));
    });

    test('atServing uses the parsed servingGrams when present', () {
      const food = PackagedFood(
        barcode: '5449000000996',
        name: 'Coca-Cola',
        servingGrams: 330,
        kcalPer100g: 42.0,
      );

      final scaled = food.atServing();

      expect(scaled['kcal'], closeTo(138.6, 0.001));
    });

    test('atServing returns all-null when servingGrams is unknown', () {
      const food = PackagedFood(
        barcode: '5449000000996',
        name: 'Coca-Cola',
        servingGrams: null,
        kcalPer100g: 42.0,
      );

      final scaled = food.atServing();

      // No honest serving size → can't scale → null, never the raw per-100g.
      expect(scaled['kcal'], isNull);
    });
  });
}
