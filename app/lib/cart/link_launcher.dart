// LinkLauncher — seam interface for opening external URLs.
//
// Separating the interface from the platform implementation lets CartPage be
// fully unit-tested without real url_launcher platform channels (tests inject
// FakeLinkLauncher; the running app uses RealLinkLauncher).

import 'package:url_launcher/url_launcher.dart';

/// Opens a [Uri] in an external application (browser, app store, etc.).
abstract class LinkLauncher {
  Future<void> launch(Uri uri);
}

/// Production implementation backed by [url_launcher].
class RealLinkLauncher implements LinkLauncher {
  const RealLinkLauncher();

  @override
  Future<void> launch(Uri uri) async {
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}
