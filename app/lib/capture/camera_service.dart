/// Thin wrapper around `image_picker` for camera / gallery image capture.
///
/// This class is NOT unit-tested — it calls into the `image_picker` plugin
/// which requires a real device (camera hardware + platform channel).
/// Keep it minimal: delegate I/O to the plugin and return a plain file path
/// (or `null`) so callers never have to import `image_picker` directly.
///
/// Real capture / scan flows (barcode, food photo) are a later phase.
/// This file establishes the thin foundation they will build on.
library;

import 'dart:io';
import 'dart:typed_data';

import 'package:image_picker/image_picker.dart';

/// Source from which an image is captured.
enum CaptureSource {
  /// Open the device camera to take a new photo.
  camera,

  /// Pick an existing image from the photo library.
  gallery,
}

/// Wraps [ImagePicker] to capture or pick a single image.
///
/// Returns the file path of the captured / selected image, or `null` if the
/// user cancelled, the permission was denied, or no camera is available.
/// Never throws — all plugin errors are caught and mapped to `null`.
class CameraService {
  CameraService({ImagePicker? picker}) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  /// Capture a photo from [source], returning its file path or `null`.
  ///
  /// [maxWidth] / [maxHeight] cap the image dimensions (pixels) to reduce
  /// memory pressure. [imageQuality] is 0–100 (JPEG compression); defaults
  /// to 85 as a reasonable quality/size balance.
  Future<String?> pickImage({
    required CaptureSource source,
    double? maxWidth,
    double? maxHeight,
    int imageQuality = 85,
  }) async {
    try {
      final pickerSource = source == CaptureSource.camera
          ? ImageSource.camera
          : ImageSource.gallery;

      final file = await _picker.pickImage(
        source: pickerSource,
        maxWidth: maxWidth,
        maxHeight: maxHeight,
        imageQuality: imageQuality,
      );

      return file?.path;
    } catch (_) {
      // Plugin can throw PlatformException (e.g. no camera, permission denied
      // at the OS level) or StateError on some devices.  Map all of these to
      // null — the caller decides what to show the user.
      return null;
    }
  }
}

/// Reads captured image files to bytes. Split out (and named distinctly) so the
/// recognition flow can turn a picked file path into the `Uint8List` the
/// recognizer needs. Dart:io only — NOT unit-tested (real filesystem).
abstract final class XImageBytes {
  /// Read the file at [path] into bytes, or `null` if it can't be read. Never
  /// throws — a missing/locked file maps to null so the caller skips it rather
  /// than fabricating content.
  static Future<Uint8List?> read(String path) async {
    try {
      return await File(path).readAsBytes();
    } catch (_) {
      return null;
    }
  }
}
