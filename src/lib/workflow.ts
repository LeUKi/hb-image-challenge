import type { UploadResult } from '../shared/contracts'
import { canChooseImage, canSubmitScore } from './participant'
import type { ParticipationState } from './participant'

/** An unsubmitted score always comes before choosing another image. */
export function recoverScoredResult(current: UploadResult | null, ownResults: UploadResult[], submitted: (id: string) => boolean, restoreAccepted: boolean): UploadResult | null {
  if (current && !submitted(current.id)) return current
  return ownResults.find(item => !submitted(item.id)) ?? current ?? (restoreAccepted ? ownResults.at(-1) ?? null : null)
}

export function challengeWorkflow(participation: ParticipationState, phase: 'idle' | 'identity' | 'processing' | 'submitting', hasFile: boolean, result: UploadResult | null, submitted: boolean) {
  if (['claimed', 'settled', 'ended'].includes(participation.kind)) return { stage: 'complete', step: 3 } as const
  if (!canChooseImage(participation) && !canSubmitScore(participation)) return { stage: 'blocked', step: null } as const
  if (hasFile && (phase === 'identity' || phase === 'processing')) return { stage: 'processing', step: 2 } as const
  if (result) return submitted ? { stage: 'next', step: 3 } as const : { stage: 'submit', step: 2 } as const
  if (participation.kind === 'exhausted') return { stage: 'blocked', step: null } as const
  return { stage: 'choose', step: hasFile ? 2 : 1 } as const
}
