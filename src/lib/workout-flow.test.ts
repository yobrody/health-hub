import { describe, expect, it } from 'vitest'
import {
  countCompletedSets,
  countTotalSets,
  describeNext,
  findFirstIncompleteSet,
  findNextIncompleteSet,
  type ExerciseState,
} from './workout-flow'

const empty: ExerciseState[] = []

const fixture = (): ExerciseState[] => [
  {
    name: 'Bench',
    sets: [
      { weight_kg: 80, reps: 8, done: false },
      { weight_kg: 80, reps: 8, done: false },
      { weight_kg: 80, reps: 8, done: false },
    ],
  },
  {
    name: 'Squat',
    sets: [
      { weight_kg: 100, reps: 5, done: false },
      { weight_kg: 100, reps: 5, done: false },
    ],
  },
]

describe('findNextIncompleteSet', () => {
  it('returns first set when nothing is done', () => {
    const exs = fixture()
    expect(findNextIncompleteSet(exs, 0, -1)).toEqual({ exerciseIdx: 0, setIdx: 0 })
  })

  it('returns next set within same exercise', () => {
    const exs = fixture()
    exs[0].sets[0].done = true
    expect(findNextIncompleteSet(exs, 0, 0)).toEqual({ exerciseIdx: 0, setIdx: 1 })
  })

  it('jumps to next exercise when current is fully done', () => {
    const exs = fixture()
    exs[0].sets.forEach(s => (s.done = true))
    expect(findNextIncompleteSet(exs, 0, 2)).toEqual({ exerciseIdx: 1, setIdx: 0 })
  })

  it('returns null when everything is done', () => {
    const exs = fixture()
    exs.forEach(ex => ex.sets.forEach(s => (s.done = true)))
    expect(findNextIncompleteSet(exs, 0, -1)).toBeNull()
  })

  it('returns null on empty workout', () => {
    expect(findNextIncompleteSet(empty, 0, -1)).toBeNull()
  })

  it('skips already-done sets in the middle', () => {
    const exs = fixture()
    exs[0].sets[0].done = true
    exs[0].sets[1].done = true
    expect(findNextIncompleteSet(exs, 0, -1)).toEqual({ exerciseIdx: 0, setIdx: 2 })
  })
})

describe('findFirstIncompleteSet', () => {
  it('returns 0/0 on a fresh workout', () => {
    expect(findFirstIncompleteSet(fixture())).toEqual({ exerciseIdx: 0, setIdx: 0 })
  })

  it('skips done sets at start', () => {
    const exs = fixture()
    exs[0].sets[0].done = true
    expect(findFirstIncompleteSet(exs)).toEqual({ exerciseIdx: 0, setIdx: 1 })
  })
})

describe('describeNext', () => {
  it('reports next-set inside the same exercise', () => {
    expect(describeNext(fixture(), { exerciseIdx: 0, setIdx: 0 })).toEqual({
      kind: 'next-set', exerciseName: 'Bench', setNumber: 2, totalSets: 3,
    })
  })

  it('reports next-exercise when last set of current done', () => {
    expect(describeNext(fixture(), { exerciseIdx: 0, setIdx: 2 })).toEqual({
      kind: 'next-exercise', exerciseName: 'Squat', totalSets: 2,
    })
  })

  it('reports workout-complete when last set of last exercise done', () => {
    expect(describeNext(fixture(), { exerciseIdx: 1, setIdx: 1 })).toEqual({
      kind: 'workout-complete',
    })
  })

  it('skips empty exercises when finding next', () => {
    const exs: ExerciseState[] = [
      fixture()[0],
      { name: 'Empty', sets: [] },
      fixture()[1],
    ]
    expect(describeNext(exs, { exerciseIdx: 0, setIdx: 2 })).toEqual({
      kind: 'next-exercise', exerciseName: 'Squat', totalSets: 2,
    })
  })
})

describe('count helpers', () => {
  it('countCompletedSets / countTotalSets', () => {
    const exs = fixture()
    expect(countCompletedSets(exs)).toBe(0)
    expect(countTotalSets(exs)).toBe(5)
    exs[0].sets[0].done = true
    exs[0].sets[1].done = true
    expect(countCompletedSets(exs)).toBe(2)
  })
})
