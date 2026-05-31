/**
 * Built-in exercise database — 50+ common exercises organized by muscle group.
 * Used by Workout.tsx for searchable exercise selection.
 */

export type MuscleGroup = 'Chest' | 'Back' | 'Shoulders' | 'Legs' | 'Arms' | 'Core' | 'Compound'
export type Equipment = 'barbell' | 'dumbbell' | 'cable' | 'bodyweight' | 'machine'

export interface Exercise {
  name: string
  muscleGroup: MuscleGroup
  equipment: Equipment
}

export const EXERCISES: Exercise[] = [
  // Chest
  { name: 'Bench Press', muscleGroup: 'Chest', equipment: 'barbell' },
  { name: 'Incline Bench Press', muscleGroup: 'Chest', equipment: 'barbell' },
  { name: 'Dumbbell Bench Press', muscleGroup: 'Chest', equipment: 'dumbbell' },
  { name: 'Incline Dumbbell Press', muscleGroup: 'Chest', equipment: 'dumbbell' },
  { name: 'Dumbbell Flyes', muscleGroup: 'Chest', equipment: 'dumbbell' },
  { name: 'Push-ups', muscleGroup: 'Chest', equipment: 'bodyweight' },
  { name: 'Cable Crossover', muscleGroup: 'Chest', equipment: 'cable' },
  { name: 'Chest Dips', muscleGroup: 'Chest', equipment: 'bodyweight' },

  // Back
  { name: 'Deadlift', muscleGroup: 'Back', equipment: 'barbell' },
  { name: 'Barbell Row', muscleGroup: 'Back', equipment: 'barbell' },
  { name: 'Pull-ups', muscleGroup: 'Back', equipment: 'bodyweight' },
  { name: 'Lat Pulldown', muscleGroup: 'Back', equipment: 'cable' },
  { name: 'Cable Row', muscleGroup: 'Back', equipment: 'cable' },
  { name: 'Face Pulls', muscleGroup: 'Back', equipment: 'cable' },
  { name: 'Dumbbell Row', muscleGroup: 'Back', equipment: 'dumbbell' },
  { name: 'T-Bar Row', muscleGroup: 'Back', equipment: 'barbell' },

  // Shoulders
  { name: 'Overhead Press', muscleGroup: 'Shoulders', equipment: 'barbell' },
  { name: 'Lateral Raises', muscleGroup: 'Shoulders', equipment: 'dumbbell' },
  { name: 'Front Raises', muscleGroup: 'Shoulders', equipment: 'dumbbell' },
  { name: 'Rear Delt Flyes', muscleGroup: 'Shoulders', equipment: 'dumbbell' },
  { name: 'Arnold Press', muscleGroup: 'Shoulders', equipment: 'dumbbell' },
  { name: 'Cable Lateral Raises', muscleGroup: 'Shoulders', equipment: 'cable' },
  { name: 'Dumbbell Shoulder Press', muscleGroup: 'Shoulders', equipment: 'dumbbell' },

  // Legs
  { name: 'Squat', muscleGroup: 'Legs', equipment: 'barbell' },
  { name: 'Leg Press', muscleGroup: 'Legs', equipment: 'machine' },
  { name: 'Romanian Deadlift', muscleGroup: 'Legs', equipment: 'barbell' },
  { name: 'Leg Extension', muscleGroup: 'Legs', equipment: 'machine' },
  { name: 'Leg Curl', muscleGroup: 'Legs', equipment: 'machine' },
  { name: 'Calf Raises', muscleGroup: 'Legs', equipment: 'machine' },
  { name: 'Bulgarian Split Squat', muscleGroup: 'Legs', equipment: 'dumbbell' },
  { name: 'Hack Squat', muscleGroup: 'Legs', equipment: 'machine' },
  { name: 'Walking Lunges', muscleGroup: 'Legs', equipment: 'dumbbell' },
  { name: 'Hip Thrust', muscleGroup: 'Legs', equipment: 'barbell' },

  // Arms
  { name: 'Barbell Curl', muscleGroup: 'Arms', equipment: 'barbell' },
  { name: 'Tricep Pushdown', muscleGroup: 'Arms', equipment: 'cable' },
  { name: 'Hammer Curl', muscleGroup: 'Arms', equipment: 'dumbbell' },
  { name: 'Skull Crushers', muscleGroup: 'Arms', equipment: 'barbell' },
  { name: 'Preacher Curl', muscleGroup: 'Arms', equipment: 'dumbbell' },
  { name: 'Overhead Tricep Extension', muscleGroup: 'Arms', equipment: 'cable' },
  { name: 'Concentration Curl', muscleGroup: 'Arms', equipment: 'dumbbell' },
  { name: 'Close-Grip Bench Press', muscleGroup: 'Arms', equipment: 'barbell' },
  { name: 'Cable Curl', muscleGroup: 'Arms', equipment: 'cable' },

  // Core
  { name: 'Plank', muscleGroup: 'Core', equipment: 'bodyweight' },
  { name: 'Cable Crunch', muscleGroup: 'Core', equipment: 'cable' },
  { name: 'Hanging Leg Raise', muscleGroup: 'Core', equipment: 'bodyweight' },
  { name: 'Ab Wheel', muscleGroup: 'Core', equipment: 'bodyweight' },
  { name: 'Russian Twist', muscleGroup: 'Core', equipment: 'bodyweight' },
  { name: 'Leg Raises', muscleGroup: 'Core', equipment: 'bodyweight' },

  // Compound
  { name: 'Clean and Press', muscleGroup: 'Compound', equipment: 'barbell' },
  { name: 'Thrusters', muscleGroup: 'Compound', equipment: 'barbell' },
  { name: "Farmer's Walk", muscleGroup: 'Compound', equipment: 'dumbbell' },
  { name: 'Kettlebell Swing', muscleGroup: 'Compound', equipment: 'dumbbell' },
  { name: 'Power Clean', muscleGroup: 'Compound', equipment: 'barbell' },
  { name: 'Snatch', muscleGroup: 'Compound', equipment: 'barbell' },
]

/** Search exercises by name — returns matches sorted by relevance */
export function searchExerciseDB(query: string): Exercise[] {
  const q = query.toLowerCase().trim()
  if (!q) return []
  return EXERCISES.filter(e =>
    e.name.toLowerCase().includes(q) ||
    e.muscleGroup.toLowerCase().includes(q) ||
    e.equipment.toLowerCase().includes(q)
  ).sort((a, b) => {
    // Exact start match first
    const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1
    const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1
    return aStarts - bStarts
  })
}

/** Get exercises grouped by muscle group */
export function getExercisesByGroup(): Record<MuscleGroup, Exercise[]> {
  const groups: Record<MuscleGroup, Exercise[]> = {
    Chest: [], Back: [], Shoulders: [], Legs: [], Arms: [], Core: [], Compound: [],
  }
  for (const ex of EXERCISES) {
    groups[ex.muscleGroup].push(ex)
  }
  return groups
}
