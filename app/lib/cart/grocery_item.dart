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
    this.createdAt,
  });

  /// Stable identifier (used as the list key + for check/remove).
  final String id;

  /// The item text exactly as the user entered it.
  final String name;

  /// Whether the user has checked it off. Real state, defaults to unchecked.
  final bool done;

  /// When the line was first added (UTC). `null` for lines created before this
  /// field existed (legacy local data) — an honest "unknown", never fabricated.
  /// Carried so the synced `created_at` column reflects the real add time.
  final DateTime? createdAt;

  GroceryItem copyWith({
    String? id,
    String? name,
    bool? done,
    DateTime? createdAt,
  }) =>
      GroceryItem(
        id: id ?? this.id,
        name: name ?? this.name,
        done: done ?? this.done,
        createdAt: createdAt ?? this.createdAt,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'done': done,
        // Only emit when known — an absent createdAt stays absent (honest),
        // never a fabricated timestamp.
        if (createdAt != null) 'createdAt': createdAt!.toIso8601String(),
      };

  factory GroceryItem.fromJson(Map<String, dynamic> json) => GroceryItem(
        id: json['id'] as String,
        name: json['name'] as String,
        done: json['done'] as bool? ?? false,
        createdAt: json['createdAt'] != null
            ? DateTime.tryParse(json['createdAt'] as String)
            : null,
      );
}
