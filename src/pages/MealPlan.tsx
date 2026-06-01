import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import { showToast } from '../toast'
import type { PlannedMeal, MealPlanResponse } from '../api/client'

const SLOT_ICONS: Record<string, string> = {
  breakfast: '\u2600\uFE0F',
  lunch: '\uD83C\uDF5D',
  dinner: '\uD83C\uDF73',
  snack: '\uD83C\uDF4E',
}

const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']

function MealCard({
  meal,
  onSwap,
  swapping,
}: {
  meal: PlannedMeal
  onSwap: (slot: string) => void
  swapping: boolean
}) {
  const icon = SLOT_ICONS[meal.slot] || '\uD83C\uDF7D\uFE0F'
  return (
    <div
      style={{
        background: 'var(--card)',
        borderRadius: 16,
        padding: '16px 18px',
        marginBottom: 12,
        border: '0.5px solid var(--c-border, rgba(0,0,0,0.06))',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--c-label-faint)', marginBottom: 4 }}>
            {icon} {meal.slot}
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--c-label)', marginBottom: 6 }}>
            {meal.name}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 13, color: 'var(--c-label-dim)', marginBottom: 8 }}>
            <span>{meal.kcal} kcal</span>
            <span>{meal.protein_g}g protein</span>
            {meal.carbs_g != null && <span>{meal.carbs_g}g carbs</span>}
            {meal.fat_g != null && <span>{meal.fat_g}g fat</span>}
          </div>
          {meal.prep_minutes != null && (
            <div style={{ fontSize: 12, color: 'var(--c-label-faint)' }}>
              ~{meal.prep_minutes} min prep
            </div>
          )}
        </div>
        <button
          onClick={() => onSwap(meal.slot)}
          disabled={swapping}
          style={{
            background: 'var(--c-bg-secondary, rgba(0,0,0,0.04))',
            border: 'none',
            borderRadius: 10,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--blue)',
            cursor: swapping ? 'wait' : 'pointer',
            opacity: swapping ? 0.5 : 1,
            marginTop: 4,
          }}
        >
          {swapping ? '...' : 'Swap'}
        </button>
      </div>

      {meal.ingredients.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--c-border, rgba(0,0,0,0.06))' }}>
          <div style={{ fontSize: 12, color: 'var(--c-label-faint)', marginBottom: 4 }}>Ingredients</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {meal.ingredients.map((ing, i) => (
              <span
                key={i}
                style={{
                  fontSize: 12,
                  background: 'var(--c-bg-secondary, rgba(0,0,0,0.04))',
                  borderRadius: 8,
                  padding: '3px 8px',
                  color: 'var(--c-label-dim)',
                }}
              >
                {ing}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function MealPlan() {
  const [plan, setPlan] = useState<MealPlanResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [swappingSlot, setSwappingSlot] = useState<string | null>(null)
  const [using, setUsing] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.generateMealPlan()
      if ('meals' in result && Array.isArray(result.meals)) {
        setPlan(result as MealPlanResponse)
        showToast('Meal plan generated')
      }
    } catch (e) {
      showToast('Failed to generate plan')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Load existing plan for tomorrow on mount
  useEffect(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const dateStr = tomorrow.toISOString().split('T')[0]
    api.getMealPlan(dateStr).then(p => setPlan(p)).catch(() => {
      // No existing plan — that's fine
    })
  }, [])

  const handleSwap = useCallback(async (slot: string) => {
    if (!plan) return
    setSwappingSlot(slot)
    try {
      const result = await api.generateMealPlan({
        swap: slot,
        existing_plan: plan.meals,
      })
      if ('meal' in result && result.meal) {
        const newMeals = plan.meals.map(m =>
          m.slot === slot ? (result as { meal: PlannedMeal }).meal : m
        )
        const newPlan: MealPlanResponse = {
          ...plan,
          meals: newMeals,
          totals: {
            kcal: newMeals.reduce((s, m) => s + (m.kcal || 0), 0),
            protein_g: newMeals.reduce((s, m) => s + (m.protein_g || 0), 0),
          },
        }
        setPlan(newPlan)
        showToast(`Swapped ${slot}`)
      }
    } catch (e) {
      showToast('Swap failed')
      console.error(e)
    } finally {
      setSwappingSlot(null)
    }
  }, [plan])

  const handleUse = useCallback(async () => {
    if (!plan) return
    setUsing(true)
    try {
      await api.useMealPlan(plan.date, plan.meals)
      showToast('Plan added to food log')
    } catch (e) {
      showToast('Failed to apply plan')
      console.error(e)
    } finally {
      setUsing(false)
    }
  }, [plan])

  const sorted = plan?.meals
    ? [...plan.meals].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
    : []

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '0 16px 120px', paddingTop: 'max(20px, env(safe-area-inset-top, 0px) + 20px)' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--c-label)', margin: 0 }}>
          Meal Plan
        </h1>
        <p style={{ fontSize: 14, color: 'var(--c-label-dim)', margin: '4px 0 0' }}>
          {plan ? `Plan for ${plan.date}` : "Generate tomorrow's meals based on your fridge and goals"}
        </p>
      </div>

      {!plan && !loading && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{'\uD83E\uDD58'}</div>
          <p style={{ fontSize: 15, color: 'var(--c-label-dim)', marginBottom: 24 }}>
            AI will create 4 meals for tomorrow using what's in your fridge, hitting your calorie and protein targets.
          </p>
          <button
            className="btn-primary"
            onClick={generate}
            style={{ margin: '0 auto' }}
          >
            Generate Meal Plan
          </button>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 12, animation: 'pulse 1.5s infinite' }}>{'\uD83E\uDD58'}</div>
          <p style={{ fontSize: 14, color: 'var(--c-label-dim)' }}>Generating your plan...</p>
        </div>
      )}

      {plan && !loading && (
        <>
          {/* Totals bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-around',
              background: 'var(--card)',
              borderRadius: 14,
              padding: '12px 16px',
              marginBottom: 16,
              border: '0.5px solid var(--c-border, rgba(0,0,0,0.06))',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-label)' }}>{plan.totals.kcal}</div>
              <div style={{ fontSize: 11, color: 'var(--c-label-faint)' }}>
                kcal {plan.targets ? `/ ${plan.targets.kcal}` : ''}
              </div>
            </div>
            <div style={{ width: 1, background: 'var(--c-border, rgba(0,0,0,0.08))' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-label)' }}>{plan.totals.protein_g}g</div>
              <div style={{ fontSize: 11, color: 'var(--c-label-faint)' }}>
                protein {plan.targets ? `/ ${plan.targets.protein_g}g` : ''}
              </div>
            </div>
          </div>

          {/* Meal cards */}
          {sorted.map(meal => (
            <MealCard
              key={meal.slot}
              meal={meal}
              onSwap={handleSwap}
              swapping={swappingSlot === meal.slot}
            />
          ))}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button
              className="btn-primary"
              onClick={handleUse}
              disabled={using}
              style={{ flex: 1 }}
            >
              {using ? 'Saving...' : 'Use This Plan'}
            </button>
            <button
              onClick={generate}
              style={{
                flex: 1,
                background: 'var(--c-bg-secondary, rgba(0,0,0,0.04))',
                border: '0.5px solid var(--c-border, rgba(0,0,0,0.08))',
                borderRadius: 12,
                padding: '12px 16px',
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--c-label)',
                cursor: 'pointer',
              }}
            >
              Regenerate
            </button>
          </div>
        </>
      )}
    </div>
  )
}
