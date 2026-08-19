/// Local push notification foundation (flutter_local_notifications wrapper).
///
/// This class is NOT unit-tested — it calls into the
/// `flutter_local_notifications` plugin which requires a real device /
/// platform channel.  Keep it minimal: init once, expose [showLocal].
///
/// SCOPE: local (on-device) notifications only.  Server → device web-push
/// (the existing backend `/push/*` endpoints + VAPID) is a later phase;
/// see the TODO below.
///
/// TODO(push-server): Wire the server-side web-push subscription flow:
///   1. Call `POST /push/subscribe` with the device token when the user opts in.
///   2. Handle foreground FCM / APNs delivery (or a background isolate for
///      flutter_local_notifications' `onDidReceiveBackgroundNotificationResponse`).
///   3. Store the subscription endpoint in SecureStore for re-subscription on
///      reinstall.
library;

import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Notification channel used for all Health Hub local notifications (Android).
const _androidChannelId = 'health_hub_local';
const _androidChannelName = 'Health Hub';
const _androidChannelDescription =
    'Health Hub reminders and readiness nudges.';

/// Wraps [FlutterLocalNotificationsPlugin] for on-device local notifications.
///
/// Initialise once at app start by calling [init].  Then call [showLocal] to
/// display a notification.  All errors are swallowed — notifications are
/// best-effort and must never crash the app.
class PushService {
  PushService({FlutterLocalNotificationsPlugin? plugin})
      : _plugin = plugin ?? FlutterLocalNotificationsPlugin();

  final FlutterLocalNotificationsPlugin _plugin;
  bool _initialised = false;

  /// Initialise the notifications plugin.
  ///
  /// Safe to call multiple times — subsequent calls are no-ops.
  ///
  /// iOS: uses [DarwinInitializationSettings] with alert / badge / sound all
  /// defaulting to `true`; the user will be prompted for permission when the
  /// first notification is scheduled (or on explicit [requestPermissions] call).
  ///
  /// Android: creates the [_androidChannelId] notification channel (required
  /// for Android 8+).
  Future<void> init() async {
    if (_initialised) return;
    try {
      const androidSettings =
          AndroidInitializationSettings('@mipmap/ic_launcher');
      const darwinSettings = DarwinInitializationSettings(
        requestAlertPermission: true,
        requestBadgePermission: true,
        requestSoundPermission: true,
      );

      const initSettings = InitializationSettings(
        android: androidSettings,
        iOS: darwinSettings,
        macOS: darwinSettings,
      );

      await _plugin.initialize(settings: initSettings);

      // Create the Android notification channel so notifications land in the
      // right channel even if the OS was upgraded after install.
      await _plugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(
            const AndroidNotificationChannel(
              _androidChannelId,
              _androidChannelName,
              description: _androidChannelDescription,
              importance: Importance.defaultImportance,
            ),
          );

      _initialised = true;
    } catch (_) {
      // Plugin init can fail on simulators or restricted environments.
      // Swallow — notifications are best-effort.
    }
  }

  /// Request the notification permission (Android 13+ POST_NOTIFICATIONS,
  /// iOS alert/badge/sound).
  ///
  /// Returns `true` if granted; `false` otherwise.
  /// On platforms / OS versions that don't need an explicit request, returns
  /// `true` immediately (the permission is already effective).
  Future<bool> requestPermissions() async {
    try {
      // iOS / macOS
      final ios = _plugin
          .resolvePlatformSpecificImplementation<
              IOSFlutterLocalNotificationsPlugin>();
      if (ios != null) {
        final granted = await ios.requestPermissions(
          alert: true,
          badge: true,
          sound: true,
        );
        return granted ?? false;
      }

      // Android 13+
      final android = _plugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();
      if (android != null) {
        final granted = await android.requestNotificationsPermission();
        return granted ?? false;
      }

      // Other platforms: assume granted.
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Display a local notification with [title] and [body].
  ///
  /// [id] disambiguates notifications; reusing an id replaces the existing one.
  /// [payload] is an optional string passed back to the app when the
  /// notification is tapped (useful for deep-linking later).
  Future<void> showLocal({
    required int id,
    required String title,
    required String body,
    String? payload,
  }) async {
    if (!_initialised) await init();
    try {
      const androidDetails = AndroidNotificationDetails(
        _androidChannelId,
        _androidChannelName,
        channelDescription: _androidChannelDescription,
        importance: Importance.defaultImportance,
        priority: Priority.defaultPriority,
      );
      const darwinDetails = DarwinNotificationDetails();
      const details = NotificationDetails(
        android: androidDetails,
        iOS: darwinDetails,
        macOS: darwinDetails,
      );

      await _plugin.show(
        id: id,
        title: title,
        body: body,
        notificationDetails: details,
        payload: payload,
      );
    } catch (_) {
      // Best-effort — swallow display errors.
    }
  }
}
