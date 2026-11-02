import { Check, ImagePlus, LoaderCircle } from 'lucide-react'
import { expectedReward, formatReward } from '../lib/challenge'
import type { AcceptedResult } from '../lib/participant'
import type { ChallengeConfig, UploadResult } from '../shared/contracts'

/** The workspace and image viewer share the same score and submission actions. */
export function ScoreActions({ result, challenge, unit, award, submitted, completed, completionLabel, showContinue, canContinue, continueLabel, canSettle, showSettlement, canSubmit, submitting, exhausted, allowed, blockedMessage, onSubmit, onContinue, onSettle }: {
  result: UploadResult
  challenge: ChallengeConfig
  unit: string
  award?: AcceptedResult
  submitted: boolean
  completed: boolean
  completionLabel: string | null
  showContinue: boolean
  canContinue: boolean
  continueLabel: string
  canSettle: boolean
  showSettlement: boolean
  canSubmit: boolean
  submitting: boolean
  exhausted: boolean
  allowed: boolean
  blockedMessage: string
  onSubmit: (result: UploadResult) => Promise<void>
  onContinue: () => void
  onSettle: () => void
}) {
  const estimate = expectedReward(result.score, challenge)
  return <>
    {challenge.multiReward && award ? <div className="reward-preview"><span>{award.reward > 0 ? '本图已计奖' : '本图奖励'}</span><strong>{formatReward(award.reward)} <span>{unit}</span></strong></div>
      : !submitted && !completed && <div className="reward-preview"><span>预计奖励</span><strong>{formatReward(estimate)} <span>{unit}</span></strong></div>}
    {completed ? completionLabel && <p className="viewer-participation">{completionLabel}</p> : !allowed ? <p className="upload-disclosure">{blockedMessage}</p> : <>
      {submitted ? <div className="next-actions">
        {showContinue && <button type="button" className="button-primary" disabled={!canContinue} onClick={onContinue}><ImagePlus size={19} aria-hidden="true" />{continueLabel}</button>}
        {challenge.multiReward && showSettlement && <button type="button" className={exhausted ? 'button-primary' : 'button-secondary'} disabled={!canSettle} onClick={onSettle}>结算并领取</button>}
      </div> : <button type="button" className="button-primary upload-submit" disabled={!canSubmit} onClick={() => void onSubmit(result)}>{submitting ? <LoaderCircle className="animate-spin" size={19} aria-hidden="true" /> : <Check size={19} aria-hidden="true" />}{submitting ? '正在计奖' : '重新提交'}</button>}
    </>}
  </>
}
