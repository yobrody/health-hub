package uk.co.healthhub.health_hub

import io.flutter.embedding.android.FlutterFragmentActivity

// Health Connect's permission flow uses `registerForActivityResult`, which
// requires a FragmentActivity host (Android 14+). The `health` plugin
// documents extending FlutterFragmentActivity instead of FlutterActivity for
// this reason — without it, requesting Health Connect permissions crashes.
class MainActivity : FlutterFragmentActivity()
