export interface ChangelogEntry {
  version: string
  date: string
  changes: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2.0.0',
    date: '2026-06-01',
    changes: [
      'Voice logging -- tap the mic to log by speaking',
      'AI chat assistant -- talk to your health coach',
      'Smart scanner -- one camera for barcodes, receipts, and food photos',
      'Editable food scan -- tap to correct what AI identified',
      'Meal planning -- AI plans tomorrow from your fridge + goals',
      'Celebration animations when you hit goals',
      'Streaks heatmap -- see all your consistency at a glance',
      'Health insights -- AI finds patterns in your data',
      'Progress rings for calories and protein',
      'Weekly report page',
      'Workout templates + 54 exercise database',
      'Micronutrient tracking (fiber, sugar, sodium)',
      'Push notification reminders',
      'Data export for backup',
      'Redesigned Nutrition, Metrics, Timeline, and Fridge pages',
    ],
  },
]

export function getUnseenChangelog(): ChangelogEntry | null {
  const lastSeen = localStorage.getItem('changelog_last_seen') || '0.0.0'
  const latest = CHANGELOG[0]
  if (!latest || latest.version <= lastSeen) return null
  return latest
}

export function markChangelogSeen(): void {
  localStorage.setItem('changelog_last_seen', CHANGELOG[0]?.version || '0.0.0')
}
