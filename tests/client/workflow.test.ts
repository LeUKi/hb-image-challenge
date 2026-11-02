import { describe, expect, it } from 'vitest'
import { challengeWorkflow, recoverScoredResult } from '../../src/lib/workflow'
import type { ParticipationKind, ParticipationState } from '../../src/lib/participant'
import type { UploadResult } from '../../src/shared/contracts'

const state = (kind: ParticipationKind): ParticipationState => ({ kind, title: '', description: '' })
const score = (id: string, attempt: number): UploadResult => ({ id, attempt, remaining: 3 - attempt, score: 75, challenge: '猫', saved: true, nsfwScore: 0, width: 100, height: 100 })
const first = score('first', 1)
const second = score('second', 2)

describe('guided challenge workflow', () => {
  it('requires submission after the last scoring attempt, rather than opening another chooser', () => {
    expect(challengeWorkflow(state('exhausted'), 'idle', false, second, false)).toEqual({ stage: 'submit', step: 2 })
    expect(challengeWorkflow(state('exhausted'), 'idle', false, second, true)).toEqual({ stage: 'next', step: 3 })
    expect(challengeWorkflow(state('exhausted'), 'idle', false, null, false).stage).toBe('blocked')
  })

  it('never exposes upload or submission while a receipt is uncertain or participation has ended', () => {
    for (const kind of ['unconfirmed', 'paused', 'not_in_scope', 'unavailable'] as const) {
      expect(challengeWorkflow(state(kind), 'processing', true, first, false).stage).toBe('blocked')
    }
    for (const kind of ['claimed', 'settled', 'ended'] as const) {
      expect(challengeWorkflow(state(kind), 'processing', true, first, false)).toEqual({ stage: 'complete', step: 3 })
    }
  })

  it('keeps selecting, scoring, submitting and choosing the next action distinct', () => {
    expect(challengeWorkflow(state('ready'), 'idle', false, null, false).step).toBe(1)
    expect(challengeWorkflow(state('ready'), 'idle', true, null, false).step).toBe(2)
    expect(challengeWorkflow(state('ready'), 'identity', true, null, false).stage).toBe('processing')
    expect(challengeWorkflow(state('ready'), 'idle', false, first, false).stage).toBe('submit')
    expect(challengeWorkflow(state('ready'), 'submitting', false, first, false).stage).toBe('submit')
    expect(challengeWorkflow(state('ready'), 'idle', false, first, true).stage).toBe('next')
  })
})

describe('recovering unfinished scoring', () => {
  it('restores the oldest unsubmitted image even when the latest image was accepted', () => {
    expect(recoverScoredResult(null, [first, second], id => id === second.id, true)).toBe(first)
    expect(recoverScoredResult(second, [first, second], id => id === second.id, true)).toBe(first)
  })

  it('preserves the current unfinished score during gallery refreshes', () => {
    expect(recoverScoredResult(second, [first], () => false, true)).toBe(second)
  })

  it('continuing skips accepted summaries but cannot skip an unfinished result', () => {
    expect(recoverScoredResult(null, [first, second], () => true, false)).toBeNull()
    expect(recoverScoredResult(null, [first, second], id => id === first.id, false)).toBe(second)
    expect(recoverScoredResult(null, [first, second], () => true, true)).toBe(second)
  })
})
