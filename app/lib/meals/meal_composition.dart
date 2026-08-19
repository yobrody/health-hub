/// The ingredient-graph model — home meals expressed as compositions of pantry
/// ingredients. This is the keystone that lets us READ the pantry to suggest
/// meals from stock and (next task) WRITE through it to deduct on eating-in.
///
/// Honesty & seam rules mirror [PantryItem]:
///  • Nullable seam fields (`ownerId`) are OMITTED from the serialised map when
///    unknown — never fabricated.
///  • `shared` is a real boolean state, always emitted, defaulting `false`.
///
/// This file is the MODEL only. The pure graph logic (makeability + honest
/// deduction) lives in `ingredient_graph.dart`.
library;

/// One line of a meal: a reference to a pantry item (by its stable `id`) plus
/// the amount required, in grams. Grams is the single reconciliation unit for
/// now (see `ingredient_graph.dart` for the unit assumption).
class Ingredient {
  const Ingredient({required this.pantryItemId, required this.grams});

  /// The `id` of the [PantryItem] this ingredient draws from.
  final String pantryItemId;

  /// The amount required, in grams. Always known (an ingredient with an
  /// unknown amount would make the recipe un-checkable — we don't model that).
  final double grams;

  Map<String, dynamic> toJson() => {
        'pantryItemId': pantryItemId,
        'grams': grams,
      };

  factory Ingredient.fromJson(Map<String, dynamic> json) => Ingredient(
        pantryItemId: json['pantryItemId'] as String,
        grams: (json['grams'] as num).toDouble(),
      );
}

/// A home meal defined as the set of pantry ingredients it consumes.
///
/// Eating-OUT is a single logged line elsewhere — it is NOT modelled here.
class MealComposition {
  const MealComposition({
    required this.id,
    required this.name,
    required this.ingredients,
    this.ownerId,
    this.shared = false,
  });

  /// Stable identifier (used in the API path + Outbox dedupe key later).
  final String id;

  /// Human-readable meal name, e.g. "Chicken & rice".
  final String name;

  /// The ingredients this meal consumes. May be empty.
  final List<Ingredient> ingredients;

  /// The social seam — owner of this composition. `null` = personal/unscoped.
  final String? ownerId;

  /// The social seam — whether this composition is shared. Defaults `false`.
  final bool shared;

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'ingredients': [for (final i in ingredients) i.toJson()],
        if (ownerId != null) 'ownerId': ownerId,
        // `shared` is a real boolean state (never "unknown"), always emitted.
        'shared': shared,
      };

  factory MealComposition.fromJson(Map<String, dynamic> json) =>
      MealComposition(
        id: json['id'] as String,
        name: json['name'] as String,
        ingredients: [
          for (final raw in (json['ingredients'] as List? ?? const []))
            Ingredient.fromJson(raw as Map<String, dynamic>),
        ],
        ownerId: json['ownerId'] as String?,
        shared: json['shared'] as bool? ?? false,
      );
}
