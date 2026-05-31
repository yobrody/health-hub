// Global celebration handler — same pattern as toast.ts
type CelebrationHandler = (type: string, message?: string) => void
let celebrationHandler: CelebrationHandler | null = null
export function registerCelebrationHandler(fn: CelebrationHandler) { celebrationHandler = fn }
export function celebrate(type: string, message?: string) { celebrationHandler?.(type, message) }
