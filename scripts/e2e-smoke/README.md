# Camera / photo smoke test (headless)

Drives every photo/camera path against a mock backend in a real Chromium and
fails on console errors or missing UI. Used to catch regressions after a push.

## Paths covered
- Camera FAB → SmartScanner: food scan, barcode scan, receipt scan (result cards,
  Home/Out toggle, place field, Log / Add-to-fridge actions)
- Nutrition "+ Add" sheet → Snap Food + barcode file inputs
- Seasonings → photo-add naming sheet

## Run (in the cloud sandbox)
    npm run build                       # dist must be current
    export NODE_PATH=/tmp/node_modules  # where playwright-core is installed
    # one server per mode, then the matching test:
    MOCK_SCAN=food    node scripts/e2e-smoke/mock-server.mjs &   # :4599
    MOCK_SCAN=food    node scripts/e2e-smoke/camera-smoke.mjs
    # repeat with MOCK_SCAN=barcode and MOCK_SCAN=receipt
Expect: `CONSOLE ERRORS: 0` and `FINDINGS: 0` in all three modes.
Screenshots land in /tmp/cam-*.png for visual review.
