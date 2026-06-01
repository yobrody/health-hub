/**
 * Built-in exercise database — 150+ exercises organized by muscle group.
 * Used by Workout.tsx for searchable exercise selection.
 */

export type MuscleGroup = 'Chest' | 'Back' | 'Shoulders' | 'Legs' | 'Arms' | 'Core' | 'Compound' | 'Warmup' | 'Cardio' | 'Stretching'
export type Equipment = 'barbell' | 'dumbbell' | 'cable' | 'bodyweight' | 'machine' | 'kettlebell' | 'band' | 'none'

export interface Exercise {
  name: string
  muscleGroup: MuscleGroup
  equipment: Equipment
  description: string
  primaryMuscles: string[]
  secondaryMuscles: string[]
}

export const EXERCISES: Exercise[] = [
  // ── Chest ──────────────────────────────────────────────────────────────
  { name: 'Bench Press', muscleGroup: 'Chest', equipment: 'barbell', description: 'Grip the bar shoulder-width, lower to chest, press up. Keep back flat on bench.', primaryMuscles: ['Pectorals'], secondaryMuscles: ['Triceps', 'Anterior Deltoid'] },
  { name: 'Incline Bench Press', muscleGroup: 'Chest', equipment: 'barbell', description: 'Set bench to 30-45 degrees. Lower bar to upper chest, press up. Targets upper pec.', primaryMuscles: ['Upper Pectorals'], secondaryMuscles: ['Triceps', 'Anterior Deltoid'] },
  { name: 'Decline Bench Press', muscleGroup: 'Chest', equipment: 'barbell', description: 'Set bench to slight decline. Lower bar to lower chest, press up.', primaryMuscles: ['Lower Pectorals'], secondaryMuscles: ['Triceps', 'Anterior Deltoid'] },
  { name: 'Dumbbell Bench Press', muscleGroup: 'Chest', equipment: 'dumbbell', description: 'Press dumbbells up from chest level. Greater range of motion than barbell.', primaryMuscles: ['Pectorals'], secondaryMuscles: ['Triceps', 'Anterior Deltoid'] },
  { name: 'Incline Dumbbell Press', muscleGroup: 'Chest', equipment: 'dumbbell', description: 'Bench at 30-45 degrees, press dumbbells from upper chest. Squeeze at top.', primaryMuscles: ['Upper Pectorals'], secondaryMuscles: ['Triceps', 'Anterior Deltoid'] },
  { name: 'Dumbbell Flyes', muscleGroup: 'Chest', equipment: 'dumbbell', description: 'Arms slightly bent, lower dumbbells out wide, squeeze chest to bring them together.', primaryMuscles: ['Pectorals'], secondaryMuscles: ['Anterior Deltoid'] },
  { name: 'Incline Dumbbell Flyes', muscleGroup: 'Chest', equipment: 'dumbbell', description: 'Incline bench flye. Keep slight elbow bend, lower wide, squeeze up.', primaryMuscles: ['Upper Pectorals'], secondaryMuscles: ['Anterior Deltoid'] },
  { name: 'Push-ups', muscleGroup: 'Chest', equipment: 'bodyweight', description: 'Hands shoulder-width, body straight. Lower chest to floor, push up. Core tight.', primaryMuscles: ['Pectorals'], secondaryMuscles: ['Triceps', 'Anterior Deltoid', 'Core'] },
  { name: 'Diamond Push-ups', muscleGroup: 'Chest', equipment: 'bodyweight', description: 'Hands close together forming a diamond. Emphasises inner chest and triceps.', primaryMuscles: ['Pectorals', 'Triceps'], secondaryMuscles: ['Anterior Deltoid'] },
  { name: 'Wide Push-ups', muscleGroup: 'Chest', equipment: 'bodyweight', description: 'Hands wider than shoulder-width. Greater chest stretch at bottom.', primaryMuscles: ['Pectorals'], secondaryMuscles: ['Anterior Deltoid'] },
  { name: 'Cable Crossover', muscleGroup: 'Chest', equipment: 'cable', description: 'Cables high, step forward, bring hands together in arc. Squeeze pecs hard at centre.', primaryMuscles: ['Pectorals'], secondaryMuscles: ['Anterior Deltoid'] },
  { name: 'Low Cable Fly', muscleGroup: 'Chest', equipment: 'cable', description: 'Cables set low, bring hands up and together. Targets upper chest.', primaryMuscles: ['Upper Pectorals'], secondaryMuscles: ['Anterior Deltoid'] },
  { name: 'Chest Dips', muscleGroup: 'Chest', equipment: 'bodyweight', description: 'Lean forward on dip bars, lower until stretch in chest. Push back up.', primaryMuscles: ['Lower Pectorals'], secondaryMuscles: ['Triceps', 'Anterior Deltoid'] },
  { name: 'Machine Chest Press', muscleGroup: 'Chest', equipment: 'machine', description: 'Seated machine press. Push handles forward, control back. Good for isolation.', primaryMuscles: ['Pectorals'], secondaryMuscles: ['Triceps', 'Anterior Deltoid'] },
  { name: 'Pec Deck', muscleGroup: 'Chest', equipment: 'machine', description: 'Seated, bring pads together in front of chest. Squeeze at peak contraction.', primaryMuscles: ['Pectorals'], secondaryMuscles: ['Anterior Deltoid'] },
  { name: 'Landmine Press', muscleGroup: 'Chest', equipment: 'barbell', description: 'Press barbell end upward from chest. One-arm or two-arm, standing or kneeling.', primaryMuscles: ['Upper Pectorals'], secondaryMuscles: ['Anterior Deltoid', 'Triceps'] },

  // ── Back ───────────────────────────────────────────────────────────────
  { name: 'Deadlift', muscleGroup: 'Back', equipment: 'barbell', description: 'Hinge at hips, grip bar outside knees, drive through floor. Keep back neutral.', primaryMuscles: ['Erector Spinae', 'Glutes'], secondaryMuscles: ['Hamstrings', 'Traps', 'Lats', 'Forearms'] },
  { name: 'Barbell Row', muscleGroup: 'Back', equipment: 'barbell', description: 'Hinge forward 45 degrees, pull bar to lower chest. Squeeze shoulder blades together.', primaryMuscles: ['Lats', 'Rhomboids'], secondaryMuscles: ['Biceps', 'Rear Deltoid', 'Traps'] },
  { name: 'Pendlay Row', muscleGroup: 'Back', equipment: 'barbell', description: 'Strict row from the floor each rep. Torso parallel, explosive pull to lower chest.', primaryMuscles: ['Lats', 'Rhomboids'], secondaryMuscles: ['Biceps', 'Rear Deltoid'] },
  { name: 'Pull-ups', muscleGroup: 'Back', equipment: 'bodyweight', description: 'Overhand grip, pull chin above bar. Full dead hang at bottom each rep.', primaryMuscles: ['Lats'], secondaryMuscles: ['Biceps', 'Teres Major', 'Rhomboids'] },
  { name: 'Chin-ups', muscleGroup: 'Back', equipment: 'bodyweight', description: 'Underhand grip, pull chin above bar. More bicep involvement than pull-ups.', primaryMuscles: ['Lats', 'Biceps'], secondaryMuscles: ['Teres Major', 'Rhomboids'] },
  { name: 'Neutral Grip Pull-ups', muscleGroup: 'Back', equipment: 'bodyweight', description: 'Palms facing each other, pull chin above bar. Easier on shoulders.', primaryMuscles: ['Lats'], secondaryMuscles: ['Biceps', 'Brachialis'] },
  { name: 'Lat Pulldown', muscleGroup: 'Back', equipment: 'cable', description: 'Wide grip, pull bar to upper chest. Lean slightly back, squeeze lats at bottom.', primaryMuscles: ['Lats'], secondaryMuscles: ['Biceps', 'Teres Major'] },
  { name: 'Close-Grip Pulldown', muscleGroup: 'Back', equipment: 'cable', description: 'V-bar or close neutral grip, pull to upper chest. Emphasises lower lats.', primaryMuscles: ['Lats'], secondaryMuscles: ['Biceps', 'Rhomboids'] },
  { name: 'Cable Row', muscleGroup: 'Back', equipment: 'cable', description: 'Seated, pull handle to stomach. Keep back upright, squeeze blades together.', primaryMuscles: ['Lats', 'Rhomboids'], secondaryMuscles: ['Biceps', 'Erector Spinae'] },
  { name: 'Single-Arm Cable Row', muscleGroup: 'Back', equipment: 'cable', description: 'One arm at a time, pull to hip. Slight rotation at top for full contraction.', primaryMuscles: ['Lats'], secondaryMuscles: ['Biceps', 'Rear Deltoid'] },
  { name: 'Face Pulls', muscleGroup: 'Back', equipment: 'cable', description: 'Rope at face height, pull to face with elbows high. External rotate at end.', primaryMuscles: ['Rear Deltoid', 'Rhomboids'], secondaryMuscles: ['Traps', 'Rotator Cuff'] },
  { name: 'Dumbbell Row', muscleGroup: 'Back', equipment: 'dumbbell', description: 'One knee on bench, pull dumbbell to hip. Keep back flat, squeeze at top.', primaryMuscles: ['Lats'], secondaryMuscles: ['Biceps', 'Rear Deltoid', 'Rhomboids'] },
  { name: 'T-Bar Row', muscleGroup: 'Back', equipment: 'barbell', description: 'Straddle bar, pull to chest with neutral grip. Keep torso at 45 degrees.', primaryMuscles: ['Lats', 'Rhomboids'], secondaryMuscles: ['Biceps', 'Traps'] },
  { name: 'Chest-Supported Row', muscleGroup: 'Back', equipment: 'dumbbell', description: 'Lie face-down on incline bench, row dumbbells up. Eliminates momentum.', primaryMuscles: ['Rhomboids', 'Lats'], secondaryMuscles: ['Biceps', 'Rear Deltoid'] },
  { name: 'Rack Pulls', muscleGroup: 'Back', equipment: 'barbell', description: 'Deadlift from knee height off pins. Overloads the lockout and upper back.', primaryMuscles: ['Erector Spinae', 'Traps'], secondaryMuscles: ['Glutes', 'Lats'] },
  { name: 'Straight-Arm Pulldown', muscleGroup: 'Back', equipment: 'cable', description: 'Arms straight, push bar down in arc from overhead to thighs. Isolates lats.', primaryMuscles: ['Lats'], secondaryMuscles: ['Teres Major', 'Rear Deltoid'] },
  { name: 'Inverted Row', muscleGroup: 'Back', equipment: 'bodyweight', description: 'Hang under a bar at waist height, pull chest to bar. Body stays straight.', primaryMuscles: ['Lats', 'Rhomboids'], secondaryMuscles: ['Biceps', 'Rear Deltoid'] },
  { name: 'Meadows Row', muscleGroup: 'Back', equipment: 'barbell', description: 'Landmine row standing perpendicular. Overhand grip, pull to hip.', primaryMuscles: ['Lats'], secondaryMuscles: ['Biceps', 'Rear Deltoid'] },
  { name: 'Seal Row', muscleGroup: 'Back', equipment: 'barbell', description: 'Lie prone on elevated bench, row barbell from full hang. Zero momentum.', primaryMuscles: ['Lats', 'Rhomboids'], secondaryMuscles: ['Biceps', 'Rear Deltoid'] },

  // ── Shoulders ──────────────────────────────────────────────────────────
  { name: 'Overhead Press', muscleGroup: 'Shoulders', equipment: 'barbell', description: 'Press bar from shoulders to overhead lockout. Squeeze glutes, brace core.', primaryMuscles: ['Anterior Deltoid', 'Medial Deltoid'], secondaryMuscles: ['Triceps', 'Upper Pectorals', 'Traps'] },
  { name: 'Dumbbell Shoulder Press', muscleGroup: 'Shoulders', equipment: 'dumbbell', description: 'Seated or standing, press dumbbells overhead. Palms forward or neutral.', primaryMuscles: ['Anterior Deltoid', 'Medial Deltoid'], secondaryMuscles: ['Triceps', 'Traps'] },
  { name: 'Arnold Press', muscleGroup: 'Shoulders', equipment: 'dumbbell', description: 'Start palms facing you, rotate outward as you press up. Hits all three delt heads.', primaryMuscles: ['Anterior Deltoid', 'Medial Deltoid'], secondaryMuscles: ['Triceps', 'Rear Deltoid'] },
  { name: 'Lateral Raises', muscleGroup: 'Shoulders', equipment: 'dumbbell', description: 'Slight bend in elbows, raise arms out to sides until parallel. Control the descent.', primaryMuscles: ['Medial Deltoid'], secondaryMuscles: ['Traps'] },
  { name: 'Cable Lateral Raises', muscleGroup: 'Shoulders', equipment: 'cable', description: 'Cable at low position, raise arm to side. Constant tension throughout range.', primaryMuscles: ['Medial Deltoid'], secondaryMuscles: ['Traps'] },
  { name: 'Front Raises', muscleGroup: 'Shoulders', equipment: 'dumbbell', description: 'Arms straight, raise weights in front to shoulder height. Alternate or simultaneous.', primaryMuscles: ['Anterior Deltoid'], secondaryMuscles: ['Medial Deltoid', 'Upper Pectorals'] },
  { name: 'Rear Delt Flyes', muscleGroup: 'Shoulders', equipment: 'dumbbell', description: 'Bent over or seated, raise dumbbells out to sides. Squeeze shoulder blades.', primaryMuscles: ['Rear Deltoid'], secondaryMuscles: ['Rhomboids', 'Traps'] },
  { name: 'Reverse Pec Deck', muscleGroup: 'Shoulders', equipment: 'machine', description: 'Face the machine, push handles back in an arc. Isolates rear delts.', primaryMuscles: ['Rear Deltoid'], secondaryMuscles: ['Rhomboids', 'Traps'] },
  { name: 'Upright Row', muscleGroup: 'Shoulders', equipment: 'barbell', description: 'Pull bar up along body to chin, elbows high. Targets traps and medial delts.', primaryMuscles: ['Traps', 'Medial Deltoid'], secondaryMuscles: ['Biceps', 'Anterior Deltoid'] },
  { name: 'Dumbbell Shrugs', muscleGroup: 'Shoulders', equipment: 'dumbbell', description: 'Hold dumbbells at sides, shrug shoulders up toward ears. Squeeze at top.', primaryMuscles: ['Traps'], secondaryMuscles: ['Levator Scapulae'] },
  { name: 'Barbell Shrugs', muscleGroup: 'Shoulders', equipment: 'barbell', description: 'Hold barbell at thighs, shrug straight up. Do not roll shoulders.', primaryMuscles: ['Traps'], secondaryMuscles: ['Levator Scapulae'] },
  { name: 'Machine Shoulder Press', muscleGroup: 'Shoulders', equipment: 'machine', description: 'Seated machine press overhead. Good for strict isolation without balance demands.', primaryMuscles: ['Anterior Deltoid', 'Medial Deltoid'], secondaryMuscles: ['Triceps'] },
  { name: 'Lu Raises', muscleGroup: 'Shoulders', equipment: 'dumbbell', description: 'Raise dumbbells to front then sweep out to sides at shoulder height.', primaryMuscles: ['Medial Deltoid', 'Anterior Deltoid'], secondaryMuscles: ['Traps'] },
  { name: 'Cable Face Pull', muscleGroup: 'Shoulders', equipment: 'cable', description: 'High cable with rope, pull to face level with elbows high. External rotate at finish.', primaryMuscles: ['Rear Deltoid'], secondaryMuscles: ['Rhomboids', 'Rotator Cuff'] },

  // ── Legs ───────────────────────────────────────────────────────────────
  { name: 'Squat', muscleGroup: 'Legs', equipment: 'barbell', description: 'Bar on upper back, squat to parallel or below. Knees track over toes.', primaryMuscles: ['Quadriceps', 'Glutes'], secondaryMuscles: ['Hamstrings', 'Erector Spinae', 'Core'] },
  { name: 'Front Squat', muscleGroup: 'Legs', equipment: 'barbell', description: 'Bar on front delts, elbows high. More upright torso, quad-dominant.', primaryMuscles: ['Quadriceps'], secondaryMuscles: ['Glutes', 'Core', 'Upper Back'] },
  { name: 'Goblet Squat', muscleGroup: 'Legs', equipment: 'dumbbell', description: 'Hold dumbbell at chest, squat deep. Great for beginners and mobility.', primaryMuscles: ['Quadriceps', 'Glutes'], secondaryMuscles: ['Core'] },
  { name: 'Leg Press', muscleGroup: 'Legs', equipment: 'machine', description: 'Feet shoulder-width on platform, lower until 90 degrees. Push through heels.', primaryMuscles: ['Quadriceps', 'Glutes'], secondaryMuscles: ['Hamstrings'] },
  { name: 'Hack Squat', muscleGroup: 'Legs', equipment: 'machine', description: 'Shoulders under pads, squat down the angled sled. Emphasis on quads.', primaryMuscles: ['Quadriceps'], secondaryMuscles: ['Glutes'] },
  { name: 'Romanian Deadlift', muscleGroup: 'Legs', equipment: 'barbell', description: 'Hinge at hips, bar slides down thighs. Keep back flat, feel hamstring stretch.', primaryMuscles: ['Hamstrings', 'Glutes'], secondaryMuscles: ['Erector Spinae'] },
  { name: 'Stiff-Leg Deadlift', muscleGroup: 'Legs', equipment: 'barbell', description: 'Like RDL but legs straighter. Greater hamstring stretch. Bar may touch floor.', primaryMuscles: ['Hamstrings'], secondaryMuscles: ['Glutes', 'Erector Spinae'] },
  { name: 'Dumbbell RDL', muscleGroup: 'Legs', equipment: 'dumbbell', description: 'Romanian deadlift with dumbbells. Hinge at hips, weight slides along thighs.', primaryMuscles: ['Hamstrings', 'Glutes'], secondaryMuscles: ['Erector Spinae'] },
  { name: 'Single-Leg RDL', muscleGroup: 'Legs', equipment: 'dumbbell', description: 'Stand on one leg, hinge forward. Great for balance and hamstring isolation.', primaryMuscles: ['Hamstrings', 'Glutes'], secondaryMuscles: ['Core', 'Erector Spinae'] },
  { name: 'Leg Extension', muscleGroup: 'Legs', equipment: 'machine', description: 'Seated, extend legs until straight. Squeeze quads at top. Control negative.', primaryMuscles: ['Quadriceps'], secondaryMuscles: [] },
  { name: 'Leg Curl', muscleGroup: 'Legs', equipment: 'machine', description: 'Lying or seated, curl heels toward glutes. Squeeze hamstrings at peak.', primaryMuscles: ['Hamstrings'], secondaryMuscles: ['Calves'] },
  { name: 'Nordic Hamstring Curl', muscleGroup: 'Legs', equipment: 'bodyweight', description: 'Kneel, anchor feet, lower body forward slowly. Eccentrically loads hamstrings.', primaryMuscles: ['Hamstrings'], secondaryMuscles: ['Glutes'] },
  { name: 'Calf Raises', muscleGroup: 'Legs', equipment: 'machine', description: 'Standing on edge, push up onto toes. Full stretch at bottom, squeeze at top.', primaryMuscles: ['Gastrocnemius'], secondaryMuscles: ['Soleus'] },
  { name: 'Seated Calf Raises', muscleGroup: 'Legs', equipment: 'machine', description: 'Seated, push through toes. Bent knee emphasises the soleus.', primaryMuscles: ['Soleus'], secondaryMuscles: ['Gastrocnemius'] },
  { name: 'Bulgarian Split Squat', muscleGroup: 'Legs', equipment: 'dumbbell', description: 'Rear foot on bench, lunge down until thigh is parallel. Unilateral quad and glute.', primaryMuscles: ['Quadriceps', 'Glutes'], secondaryMuscles: ['Hamstrings', 'Core'] },
  { name: 'Walking Lunges', muscleGroup: 'Legs', equipment: 'dumbbell', description: 'Step forward into lunge, alternate legs. Keep torso upright, knee over ankle.', primaryMuscles: ['Quadriceps', 'Glutes'], secondaryMuscles: ['Hamstrings', 'Core'] },
  { name: 'Reverse Lunges', muscleGroup: 'Legs', equipment: 'dumbbell', description: 'Step backward into lunge. Easier on knees than forward lunges.', primaryMuscles: ['Quadriceps', 'Glutes'], secondaryMuscles: ['Hamstrings'] },
  { name: 'Step-ups', muscleGroup: 'Legs', equipment: 'dumbbell', description: 'Step onto elevated platform, drive through front heel. Alternate or same-side.', primaryMuscles: ['Quadriceps', 'Glutes'], secondaryMuscles: ['Hamstrings'] },
  { name: 'Hip Thrust', muscleGroup: 'Legs', equipment: 'barbell', description: 'Upper back on bench, bar across hips. Drive hips up, squeeze glutes at top.', primaryMuscles: ['Glutes'], secondaryMuscles: ['Hamstrings', 'Core'] },
  { name: 'Glute Bridge', muscleGroup: 'Legs', equipment: 'bodyweight', description: 'Lie flat, feet planted, drive hips up. Squeeze glutes at top. Add weight to progress.', primaryMuscles: ['Glutes'], secondaryMuscles: ['Hamstrings'] },
  { name: 'Sumo Deadlift', muscleGroup: 'Legs', equipment: 'barbell', description: 'Wide stance, grip inside knees. More quad and adductor than conventional.', primaryMuscles: ['Quadriceps', 'Glutes', 'Adductors'], secondaryMuscles: ['Hamstrings', 'Erector Spinae'] },
  { name: 'Hip Adductor Machine', muscleGroup: 'Legs', equipment: 'machine', description: 'Seated, squeeze legs together. Targets inner thigh adductors.', primaryMuscles: ['Adductors'], secondaryMuscles: [] },
  { name: 'Hip Abductor Machine', muscleGroup: 'Legs', equipment: 'machine', description: 'Seated, push legs apart. Targets outer glutes and hip abductors.', primaryMuscles: ['Gluteus Medius'], secondaryMuscles: ['Tensor Fasciae Latae'] },
  { name: 'Sissy Squat', muscleGroup: 'Legs', equipment: 'bodyweight', description: 'Lean back while bending knees, lower onto toes. Intense quad isolation.', primaryMuscles: ['Quadriceps'], secondaryMuscles: ['Core'] },
  { name: 'Belt Squat', muscleGroup: 'Legs', equipment: 'machine', description: 'Weight hangs from belt at hips. Squats without spinal loading.', primaryMuscles: ['Quadriceps', 'Glutes'], secondaryMuscles: ['Hamstrings'] },

  // ── Arms ───────────────────────────────────────────────────────────────
  { name: 'Barbell Curl', muscleGroup: 'Arms', equipment: 'barbell', description: 'Elbows at sides, curl bar up. Do not swing; squeeze biceps at top.', primaryMuscles: ['Biceps'], secondaryMuscles: ['Brachialis', 'Forearms'] },
  { name: 'EZ-Bar Curl', muscleGroup: 'Arms', equipment: 'barbell', description: 'Use EZ curl bar for wrist comfort. Same motion as barbell curl.', primaryMuscles: ['Biceps'], secondaryMuscles: ['Brachialis', 'Forearms'] },
  { name: 'Dumbbell Curl', muscleGroup: 'Arms', equipment: 'dumbbell', description: 'Alternate or simultaneous. Supinate at the top for peak contraction.', primaryMuscles: ['Biceps'], secondaryMuscles: ['Brachialis'] },
  { name: 'Hammer Curl', muscleGroup: 'Arms', equipment: 'dumbbell', description: 'Neutral grip (palms facing each other). Targets brachialis and forearm.', primaryMuscles: ['Brachialis', 'Biceps'], secondaryMuscles: ['Forearms'] },
  { name: 'Preacher Curl', muscleGroup: 'Arms', equipment: 'dumbbell', description: 'Arm braced on preacher pad, curl up. Eliminates momentum, isolates biceps.', primaryMuscles: ['Biceps'], secondaryMuscles: ['Brachialis'] },
  { name: 'Concentration Curl', muscleGroup: 'Arms', equipment: 'dumbbell', description: 'Seated, elbow on inner thigh, curl up. Maximum peak biceps contraction.', primaryMuscles: ['Biceps'], secondaryMuscles: [] },
  { name: 'Incline Dumbbell Curl', muscleGroup: 'Arms', equipment: 'dumbbell', description: 'Seated on incline bench, arms hang back. Stretches biceps long head.', primaryMuscles: ['Biceps'], secondaryMuscles: [] },
  { name: 'Spider Curl', muscleGroup: 'Arms', equipment: 'dumbbell', description: 'Lean chest on incline bench, curl dumbbells. Constant tension on biceps.', primaryMuscles: ['Biceps'], secondaryMuscles: ['Brachialis'] },
  { name: 'Cable Curl', muscleGroup: 'Arms', equipment: 'cable', description: 'Low cable, curl handle up. Constant resistance through full range.', primaryMuscles: ['Biceps'], secondaryMuscles: ['Brachialis'] },
  { name: 'Bayesian Cable Curl', muscleGroup: 'Arms', equipment: 'cable', description: 'Stand facing away from low cable, curl from behind body. Stretches long head.', primaryMuscles: ['Biceps'], secondaryMuscles: [] },
  { name: 'Tricep Pushdown', muscleGroup: 'Arms', equipment: 'cable', description: 'High cable, push bar or rope down. Keep elbows pinned, extend fully.', primaryMuscles: ['Triceps'], secondaryMuscles: [] },
  { name: 'Rope Tricep Pushdown', muscleGroup: 'Arms', equipment: 'cable', description: 'Use rope attachment, split ends apart at bottom for extra contraction.', primaryMuscles: ['Triceps'], secondaryMuscles: [] },
  { name: 'Skull Crushers', muscleGroup: 'Arms', equipment: 'barbell', description: 'Lie flat, lower bar to forehead then press up. Keep elbows pointing to ceiling.', primaryMuscles: ['Triceps'], secondaryMuscles: [] },
  { name: 'Overhead Tricep Extension', muscleGroup: 'Arms', equipment: 'cable', description: 'Cable or dumbbell behind head, extend arms overhead. Stretches long head.', primaryMuscles: ['Triceps'], secondaryMuscles: [] },
  { name: 'Dumbbell Tricep Kickback', muscleGroup: 'Arms', equipment: 'dumbbell', description: 'Bent over, extend arm straight back. Squeeze triceps at full extension.', primaryMuscles: ['Triceps'], secondaryMuscles: [] },
  { name: 'Close-Grip Bench Press', muscleGroup: 'Arms', equipment: 'barbell', description: 'Hands shoulder-width or narrower. Shifts emphasis from chest to triceps.', primaryMuscles: ['Triceps'], secondaryMuscles: ['Pectorals', 'Anterior Deltoid'] },
  { name: 'Dips (Tricep)', muscleGroup: 'Arms', equipment: 'bodyweight', description: 'Upright torso on dip bars. Lower until elbows at 90 degrees, push up.', primaryMuscles: ['Triceps'], secondaryMuscles: ['Pectorals', 'Anterior Deltoid'] },
  { name: 'Wrist Curls', muscleGroup: 'Arms', equipment: 'dumbbell', description: 'Forearms on thighs, curl wrists upward. Targets forearm flexors.', primaryMuscles: ['Forearms'], secondaryMuscles: [] },
  { name: 'Reverse Wrist Curls', muscleGroup: 'Arms', equipment: 'dumbbell', description: 'Forearms on thighs palms down, extend wrists up. Targets forearm extensors.', primaryMuscles: ['Forearms'], secondaryMuscles: [] },
  { name: 'Reverse Curl', muscleGroup: 'Arms', equipment: 'barbell', description: 'Overhand grip curl. Targets brachioradialis and forearms.', primaryMuscles: ['Brachioradialis', 'Forearms'], secondaryMuscles: ['Biceps'] },

  // ── Core ───────────────────────────────────────────────────────────────
  { name: 'Plank', muscleGroup: 'Core', equipment: 'bodyweight', description: 'Forearms and toes, body straight. Hold position, brace core. Do not sag hips.', primaryMuscles: ['Rectus Abdominis', 'Transverse Abdominis'], secondaryMuscles: ['Obliques', 'Erector Spinae'] },
  { name: 'Side Plank', muscleGroup: 'Core', equipment: 'bodyweight', description: 'On one forearm, stack feet. Hold body straight. Targets obliques.', primaryMuscles: ['Obliques'], secondaryMuscles: ['Rectus Abdominis', 'Gluteus Medius'] },
  { name: 'Dead Bug', muscleGroup: 'Core', equipment: 'bodyweight', description: 'Lie on back, extend opposite arm and leg while keeping low back pressed to floor.', primaryMuscles: ['Transverse Abdominis'], secondaryMuscles: ['Rectus Abdominis', 'Hip Flexors'] },
  { name: 'Cable Crunch', muscleGroup: 'Core', equipment: 'cable', description: 'Kneel under high cable, crunch down bringing elbows to knees. Weighted ab work.', primaryMuscles: ['Rectus Abdominis'], secondaryMuscles: ['Obliques'] },
  { name: 'Hanging Leg Raise', muscleGroup: 'Core', equipment: 'bodyweight', description: 'Hang from bar, raise legs to parallel or higher. Control the descent.', primaryMuscles: ['Rectus Abdominis', 'Hip Flexors'], secondaryMuscles: ['Obliques'] },
  { name: 'Hanging Knee Raise', muscleGroup: 'Core', equipment: 'bodyweight', description: 'Hang from bar, raise knees to chest. Easier progression before leg raises.', primaryMuscles: ['Rectus Abdominis', 'Hip Flexors'], secondaryMuscles: ['Obliques'] },
  { name: 'Ab Wheel', muscleGroup: 'Core', equipment: 'bodyweight', description: 'Kneel, roll wheel forward as far as possible, pull back. Core stays tight throughout.', primaryMuscles: ['Rectus Abdominis'], secondaryMuscles: ['Lats', 'Erector Spinae', 'Hip Flexors'] },
  { name: 'Russian Twist', muscleGroup: 'Core', equipment: 'bodyweight', description: 'Seated, lean back slightly, twist torso side to side. Add weight to progress.', primaryMuscles: ['Obliques'], secondaryMuscles: ['Rectus Abdominis', 'Hip Flexors'] },
  { name: 'Leg Raises', muscleGroup: 'Core', equipment: 'bodyweight', description: 'Lie flat, raise straight legs to 90 degrees. Keep low back pressed to floor.', primaryMuscles: ['Rectus Abdominis', 'Hip Flexors'], secondaryMuscles: [] },
  { name: 'Bicycle Crunches', muscleGroup: 'Core', equipment: 'bodyweight', description: 'Alternate elbow to opposite knee in cycling motion. Targets obliques and abs.', primaryMuscles: ['Obliques', 'Rectus Abdominis'], secondaryMuscles: ['Hip Flexors'] },
  { name: 'V-ups', muscleGroup: 'Core', equipment: 'bodyweight', description: 'Lie flat, simultaneously raise legs and torso to form a V. Touch toes.', primaryMuscles: ['Rectus Abdominis'], secondaryMuscles: ['Hip Flexors'] },
  { name: 'Mountain Climbers', muscleGroup: 'Core', equipment: 'bodyweight', description: 'Plank position, alternate driving knees to chest rapidly. Core and cardio.', primaryMuscles: ['Core', 'Hip Flexors'], secondaryMuscles: ['Shoulders', 'Quadriceps'] },
  { name: 'Pallof Press', muscleGroup: 'Core', equipment: 'cable', description: 'Stand sideways to cable, press handle away from chest. Anti-rotation core work.', primaryMuscles: ['Obliques', 'Transverse Abdominis'], secondaryMuscles: ['Rectus Abdominis'] },
  { name: 'Woodchoppers', muscleGroup: 'Core', equipment: 'cable', description: 'Cable high to low or low to high diagonal chop. Rotate through torso.', primaryMuscles: ['Obliques'], secondaryMuscles: ['Rectus Abdominis', 'Shoulders'] },
  { name: 'Hollow Body Hold', muscleGroup: 'Core', equipment: 'bodyweight', description: 'Lie on back, arms overhead, legs straight. Lift both off floor, hold.', primaryMuscles: ['Rectus Abdominis', 'Transverse Abdominis'], secondaryMuscles: ['Hip Flexors'] },
  { name: 'Copenhagen Plank', muscleGroup: 'Core', equipment: 'bodyweight', description: 'Side plank with top leg on bench. Targets adductors and obliques.', primaryMuscles: ['Obliques', 'Adductors'], secondaryMuscles: ['Core'] },

  // ── Compound ───────────────────────────────────────────────────────────
  { name: 'Clean and Press', muscleGroup: 'Compound', equipment: 'barbell', description: 'Clean bar to shoulders, then press overhead. Full body power movement.', primaryMuscles: ['Shoulders', 'Traps', 'Glutes'], secondaryMuscles: ['Quadriceps', 'Hamstrings', 'Core'] },
  { name: 'Clean and Jerk', muscleGroup: 'Compound', equipment: 'barbell', description: 'Clean to shoulders, dip and drive bar overhead with leg drive.', primaryMuscles: ['Shoulders', 'Quadriceps', 'Glutes'], secondaryMuscles: ['Traps', 'Triceps', 'Core'] },
  { name: 'Thrusters', muscleGroup: 'Compound', equipment: 'barbell', description: 'Front squat into overhead press in one fluid motion. Brutal full-body conditioning.', primaryMuscles: ['Quadriceps', 'Shoulders'], secondaryMuscles: ['Glutes', 'Triceps', 'Core'] },
  { name: "Farmer's Walk", muscleGroup: 'Compound', equipment: 'dumbbell', description: 'Heavy weights at sides, walk with upright posture. Grip, core, and conditioning.', primaryMuscles: ['Forearms', 'Traps'], secondaryMuscles: ['Core', 'Legs'] },
  { name: 'Kettlebell Swing', muscleGroup: 'Compound', equipment: 'kettlebell', description: 'Hinge at hips, swing bell to shoulder height. Snap hips forward explosively.', primaryMuscles: ['Glutes', 'Hamstrings'], secondaryMuscles: ['Core', 'Shoulders', 'Lats'] },
  { name: 'Power Clean', muscleGroup: 'Compound', equipment: 'barbell', description: 'Explosive pull from floor, catch bar on front delts. Triple extension of ankles, knees, hips.', primaryMuscles: ['Traps', 'Glutes', 'Hamstrings'], secondaryMuscles: ['Quadriceps', 'Core', 'Shoulders'] },
  { name: 'Snatch', muscleGroup: 'Compound', equipment: 'barbell', description: 'Wide grip, pull bar from floor to overhead in one motion. Requires mobility and technique.', primaryMuscles: ['Shoulders', 'Traps', 'Glutes'], secondaryMuscles: ['Hamstrings', 'Quadriceps', 'Core'] },
  { name: 'Turkish Get-up', muscleGroup: 'Compound', equipment: 'kettlebell', description: 'Lie down holding weight overhead, stand up while keeping arm locked out. Full body.', primaryMuscles: ['Core', 'Shoulders'], secondaryMuscles: ['Glutes', 'Quadriceps', 'Triceps'] },
  { name: 'Burpees', muscleGroup: 'Compound', equipment: 'bodyweight', description: 'Squat down, jump feet back to plank, push-up, jump feet in, jump up. Repeat.', primaryMuscles: ['Quadriceps', 'Pectorals'], secondaryMuscles: ['Shoulders', 'Triceps', 'Core', 'Glutes'] },
  { name: 'Man Makers', muscleGroup: 'Compound', equipment: 'dumbbell', description: 'Burpee with dumbbells: push-up, row each side, clean, press overhead.', primaryMuscles: ['Full Body'], secondaryMuscles: [] },
  { name: 'Barbell Complex', muscleGroup: 'Compound', equipment: 'barbell', description: 'Chain of movements without putting bar down: deadlift, row, clean, press, squat.', primaryMuscles: ['Full Body'], secondaryMuscles: [] },
  { name: 'Bear Crawl', muscleGroup: 'Compound', equipment: 'bodyweight', description: 'Hands and feet on ground, knees hovering. Crawl forward. Core and coordination.', primaryMuscles: ['Core', 'Shoulders'], secondaryMuscles: ['Quadriceps', 'Hip Flexors'] },

  // ── Warmup ─────────────────────────────────────────────────────────────
  { name: 'Arm Circles', muscleGroup: 'Warmup', equipment: 'none', description: 'Standing, swing arms in circles. Small circles progressing to large. Warms rotator cuff.', primaryMuscles: ['Shoulders'], secondaryMuscles: ['Rotator Cuff'] },
  { name: 'Leg Swings', muscleGroup: 'Warmup', equipment: 'none', description: 'Hold support, swing one leg forward and back. Loosens hips and hamstrings.', primaryMuscles: ['Hip Flexors', 'Hamstrings'], secondaryMuscles: ['Glutes'] },
  { name: 'Band Pull-aparts', muscleGroup: 'Warmup', equipment: 'band', description: 'Hold band at chest, pull apart until arms wide. Fires rear delts and rhomboids.', primaryMuscles: ['Rear Deltoid', 'Rhomboids'], secondaryMuscles: ['Traps'] },
  { name: 'Band Dislocates', muscleGroup: 'Warmup', equipment: 'band', description: 'Wide grip on band, arc it overhead and behind back. Shoulder mobility drill.', primaryMuscles: ['Shoulders'], secondaryMuscles: ['Rotator Cuff'] },
  { name: 'Inchworm', muscleGroup: 'Warmup', equipment: 'none', description: 'Bend forward, walk hands out to plank, walk feet to hands. Stand and repeat.', primaryMuscles: ['Hamstrings', 'Core'], secondaryMuscles: ['Shoulders'] },
  { name: 'Cat-Cow', muscleGroup: 'Warmup', equipment: 'none', description: 'On hands and knees, alternate arching and rounding spine. Spinal mobility.', primaryMuscles: ['Erector Spinae'], secondaryMuscles: ['Core'] },
  { name: 'Hip Circles', muscleGroup: 'Warmup', equipment: 'none', description: 'Standing, draw large circles with your knee raised. Opens hip joint.', primaryMuscles: ['Hip Flexors'], secondaryMuscles: ['Glutes'] },
  { name: 'Jumping Jacks', muscleGroup: 'Warmup', equipment: 'none', description: 'Jump feet wide while raising arms overhead. General warm-up and light cardio.', primaryMuscles: ['Full Body'], secondaryMuscles: [] },
  { name: 'High Knees', muscleGroup: 'Warmup', equipment: 'none', description: 'Jog in place driving knees to waist height. Elevates heart rate quickly.', primaryMuscles: ['Hip Flexors', 'Quadriceps'], secondaryMuscles: ['Calves', 'Core'] },
  { name: 'Butt Kicks', muscleGroup: 'Warmup', equipment: 'none', description: 'Jog in place kicking heels to glutes. Warms hamstrings and raises heart rate.', primaryMuscles: ['Hamstrings'], secondaryMuscles: ['Calves'] },

  // ── Cardio ─────────────────────────────────────────────────────────────
  { name: 'Treadmill Run', muscleGroup: 'Cardio', equipment: 'machine', description: 'Steady-state or interval running on treadmill. Control pace and incline.', primaryMuscles: ['Quadriceps', 'Hamstrings', 'Calves'], secondaryMuscles: ['Glutes', 'Core'] },
  { name: 'Treadmill Walk', muscleGroup: 'Cardio', equipment: 'machine', description: 'Low impact walking. Increase incline for more glute and calf engagement.', primaryMuscles: ['Quadriceps', 'Calves'], secondaryMuscles: ['Glutes'] },
  { name: 'Incline Treadmill Walk', muscleGroup: 'Cardio', equipment: 'machine', description: 'Walk at 10-15% incline. Low impact but high calorie burn. Targets glutes.', primaryMuscles: ['Glutes', 'Calves'], secondaryMuscles: ['Hamstrings', 'Quadriceps'] },
  { name: 'Stationary Bike', muscleGroup: 'Cardio', equipment: 'machine', description: 'Cycling on stationary bike. Adjust resistance for intervals or steady state.', primaryMuscles: ['Quadriceps', 'Hamstrings'], secondaryMuscles: ['Calves', 'Glutes'] },
  { name: 'Rowing Machine', muscleGroup: 'Cardio', equipment: 'machine', description: 'Drive through legs, lean back, pull handle to chest. Full body low-impact cardio.', primaryMuscles: ['Lats', 'Quadriceps'], secondaryMuscles: ['Biceps', 'Core', 'Glutes'] },
  { name: 'Elliptical', muscleGroup: 'Cardio', equipment: 'machine', description: 'Smooth striding motion. Low impact on joints, moderate calorie burn.', primaryMuscles: ['Quadriceps', 'Glutes'], secondaryMuscles: ['Hamstrings', 'Core'] },
  { name: 'Stair Climber', muscleGroup: 'Cardio', equipment: 'machine', description: 'Step continuously on rotating stairs. High calorie burn, targets glutes and quads.', primaryMuscles: ['Quadriceps', 'Glutes'], secondaryMuscles: ['Calves', 'Hamstrings'] },
  { name: 'Assault Bike', muscleGroup: 'Cardio', equipment: 'machine', description: 'Air resistance bike with arm handles. The harder you push, the harder it gets.', primaryMuscles: ['Quadriceps', 'Shoulders'], secondaryMuscles: ['Core', 'Hamstrings', 'Triceps'] },
  { name: 'Jump Rope', muscleGroup: 'Cardio', equipment: 'none', description: 'Skip rope continuously. Great for coordination, calf conditioning, and heart rate.', primaryMuscles: ['Calves'], secondaryMuscles: ['Shoulders', 'Core', 'Quadriceps'] },
  { name: 'Box Jumps', muscleGroup: 'Cardio', equipment: 'bodyweight', description: 'Jump onto a raised box, stand tall, step down. Explosive lower body power.', primaryMuscles: ['Quadriceps', 'Glutes'], secondaryMuscles: ['Calves', 'Hamstrings'] },
  { name: 'Battle Ropes', muscleGroup: 'Cardio', equipment: 'none', description: 'Whip heavy ropes in waves, slams, or circles. Upper body conditioning.', primaryMuscles: ['Shoulders', 'Core'], secondaryMuscles: ['Biceps', 'Forearms'] },
  { name: 'Sled Push', muscleGroup: 'Cardio', equipment: 'machine', description: 'Push weighted sled across floor. Lower body drive with cardio demand.', primaryMuscles: ['Quadriceps', 'Glutes'], secondaryMuscles: ['Calves', 'Core'] },

  // ── Stretching ─────────────────────────────────────────────────────────
  { name: 'Standing Hamstring Stretch', muscleGroup: 'Stretching', equipment: 'none', description: 'Stand, hinge at hips, reach toward toes. Keep back flat, feel pull in hamstrings.', primaryMuscles: ['Hamstrings'], secondaryMuscles: ['Erector Spinae'] },
  { name: 'Quad Stretch', muscleGroup: 'Stretching', equipment: 'none', description: 'Stand on one leg, pull heel to glutes. Keep knees together, hips pushed forward.', primaryMuscles: ['Quadriceps'], secondaryMuscles: ['Hip Flexors'] },
  { name: 'Pigeon Pose', muscleGroup: 'Stretching', equipment: 'none', description: 'One leg bent in front, other extended behind. Deep hip and glute stretch.', primaryMuscles: ['Glutes', 'Hip Flexors'], secondaryMuscles: ['Piriformis'] },
  { name: '90/90 Hip Stretch', muscleGroup: 'Stretching', equipment: 'none', description: 'Both legs at 90 degrees on floor. Rotate between internal and external hip rotation.', primaryMuscles: ['Hip Flexors', 'Glutes'], secondaryMuscles: ['Adductors'] },
  { name: 'Doorway Chest Stretch', muscleGroup: 'Stretching', equipment: 'none', description: 'Forearm on doorframe, lean through. Opens pecs and anterior deltoid.', primaryMuscles: ['Pectorals', 'Anterior Deltoid'], secondaryMuscles: [] },
  { name: 'Child\'s Pose', muscleGroup: 'Stretching', equipment: 'none', description: 'Kneel, sit back on heels, reach arms forward on floor. Stretches lats and lower back.', primaryMuscles: ['Lats', 'Erector Spinae'], secondaryMuscles: ['Shoulders'] },
  { name: 'Cat-Cow Stretch', muscleGroup: 'Stretching', equipment: 'none', description: 'On all fours, alternate arching (cow) and rounding (cat) the spine slowly.', primaryMuscles: ['Erector Spinae'], secondaryMuscles: ['Core'] },
  { name: 'World\'s Greatest Stretch', muscleGroup: 'Stretching', equipment: 'none', description: 'Lunge, place hand on floor, rotate other arm to sky. Hits hips, thoracic spine, hamstrings.', primaryMuscles: ['Hip Flexors', 'Thoracic Spine'], secondaryMuscles: ['Hamstrings', 'Obliques'] },
  { name: 'Foam Rolling (Quads)', muscleGroup: 'Stretching', equipment: 'none', description: 'Face down, roll foam roller along front of thighs. Pause on tight spots.', primaryMuscles: ['Quadriceps'], secondaryMuscles: [] },
  { name: 'Foam Rolling (Back)', muscleGroup: 'Stretching', equipment: 'none', description: 'Lie on roller, roll from mid-back to upper back. Releases thoracic tightness.', primaryMuscles: ['Erector Spinae', 'Thoracic Spine'], secondaryMuscles: [] },
  { name: 'Hip Flexor Stretch', muscleGroup: 'Stretching', equipment: 'none', description: 'Half-kneeling, push hips forward. Squeeze rear glute for deeper stretch.', primaryMuscles: ['Hip Flexors'], secondaryMuscles: ['Quadriceps'] },
  { name: 'Lat Stretch', muscleGroup: 'Stretching', equipment: 'none', description: 'Grab a pole or doorframe overhead, lean away. Feel stretch along side and lat.', primaryMuscles: ['Lats'], secondaryMuscles: ['Obliques'] },
]

/** Search exercises by name — returns matches sorted by relevance */
export function searchExerciseDB(query: string): Exercise[] {
  const q = query.toLowerCase().trim()
  if (!q) return []
  return EXERCISES.filter(e =>
    e.name.toLowerCase().includes(q) ||
    e.muscleGroup.toLowerCase().includes(q) ||
    e.equipment.toLowerCase().includes(q) ||
    e.primaryMuscles.some(m => m.toLowerCase().includes(q)) ||
    e.secondaryMuscles.some(m => m.toLowerCase().includes(q))
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
    Warmup: [], Cardio: [], Stretching: [],
  }
  for (const ex of EXERCISES) {
    groups[ex.muscleGroup].push(ex)
  }
  return groups
}

/** Look up an exercise by exact name */
export function findExercise(name: string): Exercise | undefined {
  return EXERCISES.find(e => e.name === name)
}
