// Unit tests for KitchenLayout + KitchenLayoutRepo (R-3).
//
// The layout is a COSMETIC single/double appliance display preference. These
// tests lock: the all-single default, toggling one appliance leaves others
// alone, round-trip JSON, unknown/absent values default to single, and the repo
// persists a toggle.

import 'package:flutter_test/flutter_test.dart';
import 'package:health_hub/kitchen/kitchen_layout.dart';

class _FakeStore implements KitchenLayoutStore {
  KitchenLayout layout = KitchenLayout.initial;
  int saveCount = 0;
  @override
  Future<KitchenLayout> load() async => layout;
  @override
  Future<void> save(KitchenLayout l) async {
    layout = l;
    saveCount++;
  }
}

void main() {
  test('default layout is all-single', () {
    const l = KitchenLayout.initial;
    expect(l.fridge, ApplianceSize.single);
    expect(l.pantry, ApplianceSize.single);
    expect(l.freezer, ApplianceSize.single);
  });

  test('toggling one appliance leaves the others unchanged', () {
    final l = const KitchenLayout().toggled(ToggleableAppliance.fridge);
    expect(l.fridge, ApplianceSize.double_);
    expect(l.pantry, ApplianceSize.single);
    expect(l.freezer, ApplianceSize.single);

    final back = l.toggled(ToggleableAppliance.fridge);
    expect(back.fridge, ApplianceSize.single);
    expect(back, const KitchenLayout());
  });

  test('sizeOf reflects the set size', () {
    final l = const KitchenLayout()
        .withSize(ToggleableAppliance.freezer, ApplianceSize.double_);
    expect(l.sizeOf(ToggleableAppliance.freezer), ApplianceSize.double_);
    expect(l.sizeOf(ToggleableAppliance.fridge), ApplianceSize.single);
  });

  test('JSON round-trips', () {
    final l = const KitchenLayout()
        .toggled(ToggleableAppliance.pantry)
        .toggled(ToggleableAppliance.freezer);
    final round = KitchenLayout.fromJson(l.toJson());
    expect(round, l);
  });

  test('unknown/absent JSON values default to single (honest minimal)', () {
    final l = KitchenLayout.fromJson({'fridge': 'bogus'});
    expect(l.fridge, ApplianceSize.single);
    expect(l.pantry, ApplianceSize.single);
    expect(l.freezer, ApplianceSize.single);
  });

  test('repo.toggle flips and persists', () async {
    final store = _FakeStore();
    final repo = KitchenLayoutRepo(store: store);

    final next = await repo.toggle(ToggleableAppliance.fridge);
    expect(next.fridge, ApplianceSize.double_);
    expect(store.saveCount, 1);
    expect((await repo.load()).fridge, ApplianceSize.double_);

    final back = await repo.toggle(ToggleableAppliance.fridge);
    expect(back.fridge, ApplianceSize.single);
    expect(store.saveCount, 2);
  });
}
