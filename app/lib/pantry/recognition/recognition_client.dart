/// The recognition client seam (R-2): turns captured photos into
/// [RecognitionResult] suggestions.
///
/// Two implementations:
///  • [SupabaseRecognitionClient] — the REAL one. Base64-encodes the images and
///    calls the `recognize-pantry` Edge Function, parsing its JSON into a
///    [RecognitionResult]. On ANY failure it throws a [RecognitionFailure] —
///    it NEVER fabricates items, and it never returns a partial/guessed list on
///    error. The UI surfaces the failure truthfully and falls back to manual.
///  • [FakePantryRecognitionClient] — for tests. Returns a canned result (or a
///    thrown failure) with no network.
///
/// [pantryRecognitionClientProvider] is overridable in tests via
/// `ProviderScope(overrides: [...])`, so the real Supabase client is NEVER
/// instantiated in a test path.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'pantry_recognition.dart';

/// The name of the Supabase Edge Function this client calls.
const String kRecognizePantryFunction = 'recognize-pantry';

/// A typed, honest failure surface for recognition. The UI shows [message] and
/// falls back to manual add — it never turns a failure into fabricated items.
class RecognitionFailure implements Exception {
  const RecognitionFailure(this.message, {this.cause});

  /// A short, user-safe explanation ("Couldn't reach the recognizer", etc.).
  final String message;

  /// The originating error, for logging/diagnostics (never shown as truth).
  final Object? cause;

  @override
  String toString() => 'RecognitionFailure($message)';
}

/// The recognition seam. Implementations turn photos into suggestions.
abstract class PantryRecognitionClient {
  /// Recognize items from one or more captured image byte buffers.
  ///
  /// Returns a [RecognitionResult] (possibly empty — the honest "nothing seen"
  /// state). Throws [RecognitionFailure] on any error; never fabricates items.
  Future<RecognitionResult> recognize(List<Uint8List> images);
}

/// The REAL client — calls the `recognize-pantry` Edge Function.
class SupabaseRecognitionClient implements PantryRecognitionClient {
  SupabaseRecognitionClient(this._client);

  final SupabaseClient _client;

  @override
  Future<RecognitionResult> recognize(List<Uint8List> images) async {
    if (images.isEmpty) {
      // Nothing to recognize — an honest empty result, not an error and not an
      // invented item.
      return RecognitionResult.empty;
    }

    final encoded = images.map(base64Encode).toList(growable: false);

    final FunctionResponse response;
    try {
      response = await _client.functions.invoke(
        kRecognizePantryFunction,
        body: {'images': encoded},
      );
    } on FunctionException catch (e) {
      throw RecognitionFailure(
        'Recognition failed (${e.status}). Add items manually.',
        cause: e,
      );
    } catch (e) {
      throw RecognitionFailure(
        'Couldn\'t reach the recognizer. Add items manually.',
        cause: e,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw RecognitionFailure(
        'Recognition failed (${response.status}). Add items manually.',
      );
    }

    final data = response.data;
    if (data is! Map) {
      throw const RecognitionFailure(
        'The recognizer returned an unexpected response. Add items manually.',
      );
    }

    try {
      return RecognitionResult.fromJson(Map<String, dynamic>.from(data));
    } catch (e) {
      throw RecognitionFailure(
        'Couldn\'t read the recognizer\'s response. Add items manually.',
        cause: e,
      );
    }
  }
}

/// A test/offline client — returns a canned [result] (or throws [error]).
class FakePantryRecognitionClient implements PantryRecognitionClient {
  FakePantryRecognitionClient({
    RecognitionResult? result,
    this.error,
  }) : result = result ?? RecognitionResult.empty;

  /// The canned result to return.
  final RecognitionResult result;

  /// When non-null, [recognize] throws this instead of returning [result] —
  /// lets a test drive the honest error/fallback path.
  final Object? error;

  /// The images last passed to [recognize] — lets a test assert the capture
  /// seam actually forwarded bytes.
  List<Uint8List> lastImages = const [];

  @override
  Future<RecognitionResult> recognize(List<Uint8List> images) async {
    lastImages = images;
    if (error != null) throw error!;
    return result;
  }
}

/// The recognition client provider.
///
/// Defaults to the REAL [SupabaseRecognitionClient] ONLY when Supabase is
/// configured; otherwise it throws on read (there is no live recognizer in a
/// degraded/local build). Tests ALWAYS override this with a
/// [FakePantryRecognitionClient], so the real client is never built under test.
final pantryRecognitionClientProvider =
    Provider<PantryRecognitionClient>((ref) {
  return SupabaseRecognitionClient(Supabase.instance.client);
});
