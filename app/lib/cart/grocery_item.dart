/// A single line on the Cart grocery-list notepad.
///
/// This is real, user-owned data — the name the user typed and whether they've
/// checked it off. Nothing here is fabricated: an item exists only because the
/// user (or an accepted "restock soon" suggestion) added it.
library;

class GroceryItem {
  const GroceryItem({
    required this.id,
    required this.name,
    this.done = false,
  });

  /// Stable identifier (used as the list key + for check/remove).
  final String id;

  /// The item text exactly as the user entered it.
  final String name;

  /// Whether the user has checked it off. Real state, defaults to unchecked.
  final bool done;

  GroceryItem copyWith({String? id, String? name, bool? done}) => GroceryItem(
        id: id ?? this.id,
        name: name ?? this.name,
        done: done ?? this.done,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'done': done,
      };

  factory GroceryItem.fromJson(Map<String, dynamic> json) => GroceryItem(
        id: json['id'] as String,
        name: json['name'] as String,
        done: json['done'] as bool? ?? false,
      );
}
