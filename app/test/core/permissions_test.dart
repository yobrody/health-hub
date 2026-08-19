import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/core/permissions.dart';

void main() {
  group('PermissionCoordinator.fromStatus', () {
    test('maps granted → PermState.granted', () {
      expect(
        PermissionCoordinator.fromStatus(RawPermStatus.granted),
        PermState.granted,
      );
    });

    test('maps denied → PermState.denied', () {
      expect(
        PermissionCoordinator.fromStatus(RawPermStatus.denied),
        PermState.denied,
      );
    });

    test('maps permanentlyDenied → PermState.permanentlyDenied', () {
      expect(
        PermissionCoordinator.fromStatus(RawPermStatus.permanentlyDenied),
        PermState.permanentlyDenied,
      );
    });

    test('maps restricted → PermState.restricted', () {
      expect(
        PermissionCoordinator.fromStatus(RawPermStatus.restricted),
        PermState.restricted,
      );
    });
  });

  group('PermissionCoordinator.canRequest', () {
    test('returns true for denied (user can still be asked)', () {
      expect(PermissionCoordinator.canRequest(PermState.denied), isTrue);
    });

    test('returns false for granted (already have it)', () {
      expect(PermissionCoordinator.canRequest(PermState.granted), isFalse);
    });

    test('returns false for permanentlyDenied (must open settings)', () {
      expect(
        PermissionCoordinator.canRequest(PermState.permanentlyDenied),
        isFalse,
      );
    });

    test('returns false for restricted (OS-level block)', () {
      expect(PermissionCoordinator.canRequest(PermState.restricted), isFalse);
    });
  });

  group('PermissionCoordinator.mustOpenSettings', () {
    test('returns true for permanentlyDenied', () {
      expect(
        PermissionCoordinator.mustOpenSettings(PermState.permanentlyDenied),
        isTrue,
      );
    });

    test('returns true for restricted', () {
      expect(
        PermissionCoordinator.mustOpenSettings(PermState.restricted),
        isTrue,
      );
    });

    test('returns false for denied', () {
      expect(
        PermissionCoordinator.mustOpenSettings(PermState.denied),
        isFalse,
      );
    });

    test('returns false for granted', () {
      expect(
        PermissionCoordinator.mustOpenSettings(PermState.granted),
        isFalse,
      );
    });
  });
}
