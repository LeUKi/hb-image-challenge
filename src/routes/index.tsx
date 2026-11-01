import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from '@tanstack/react-form'
import { useAtom } from 'jotai'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Check, CheckCircle2, ChevronDown, CircleHelp, ImagePlus, LoaderCircle, LockKeyhole, RotateCcw, Sparkles, X } from 'lucide-react'
import { Layout } from '../components/layout'
import { apiJson, connectHongbao } from '../lib/hongbao'
import { instructionsAtom, noticeAtom, phaseAtom, resultAtom, sessionAtom } from '../lib/state'
import { DEFAULT_CHALLENGE, MAX_IMAGE_BYTES } from '../shared/contracts'
import type { ChallengeConfig, PublicConfig, UploadResult } from '../shared/contracts'
import type { HbHongbao } from '../types/hb-sdk'

export const Route = createFileRoute('/')({ component: ChallengePage })

function displayedChallenge(hongbao?: HbHongbao): ChallengeConfig {
  const p = hongbao?.params
  return {
    challenge: typeof p?.challenge === 'string' ? p.challenge : DEFAULT_CHALLENGE.challenge,
    minScore: typeof p?.minScore === 'number' ? p.minScore : DEFAULT_CHALLENGE.minScore,
    maxScore: typeof p?.maxScore === 'number' ? p.maxScore : DEFAULT_CHALLENGE.maxScore,
    maxAttempts: typeof p?.maxAttempts === 'number' ? p.maxAttempts : DEFAULT_CHALLENGE.maxAttempts,
    saveImages: typeof p?.saveImages === 'boolean' ? p.saveImages : DEFAULT_CHALLENGE.saveImages,
  }
}

function ChallengePage() {
  const [session, setSession] = useAtom(sessionAtom)
  const [notice, setNotice] = useAtom(noticeAtom)
  const [result, setResult] = useAtom(resultAtom)
  const [phase, setPhase] = useAtom(phaseAtom)
  const [instructions, setInstructions] = useAtom(instructionsAtom)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [fileMeta, setFileMeta] = useState<{ name: string; size: number } | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const idempotency = useRef('')
  const [submissionBlocked, setSubmissionBlocked] = useState(false)
  const config = useQuery({ queryKey: ['service-config'], queryFn: () => apiJson<PublicConfig>('/api/config'), enabled: typeof window !== 'undefined' })
  const challenge = displayedChallenge(session.hongbao)
  const connected = session.status === 'connected'
  const busy = phase !== 'idle'
  const exhausted = remaining === 0

  useEffect(() => {
    if (window.parent === window) { setSession({ status: 'standalone' }); return }
    if (!config.data) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void connectHongbao(config.data.hbSite).then(async sdk => {
      const ready = await sdk.ready()
      if (disposed) return
      setSession({ status: 'connected', sdk, ...ready })
      unsubscribe = sdk.on('hongbao', hongbao => setSession(previous => ({ ...previous, hongbao })))
    }).catch(error => { if (!disposed) setSession({ status: 'error', error: error instanceof Error ? error.message : '无法连接红包站' }) })
    return () => { disposed = true; unsubscribe?.() }
  }, [config.data, setSession])

  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  const upload = useMutation({
    retry: false,
    mutationFn: async (file: File) => {
      if (!session.sdk) throw new Error('请从红包页打开后再参与挑战')
      setPhase('identity')
      const { nonce } = await apiJson<{ nonce: string }>('/api/nonce', { method: 'POST' })
      const identity = await session.sdk.identity({ nonce })
      if (!identity.identified) throw new Error(identity.message || '需要允许身份验证，才能上传图片')
      setPhase('processing')
      return apiJson<UploadResult>('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': file.type, Authorization: `Bearer ${identity.token}`, 'X-Hb-Nonce': nonce, 'Idempotency-Key': idempotency.current },
        body: file,
      })
    },
    onSuccess: value => { setResult(value); setRemaining(value.remaining); setNotice(null) },
    onError: error => setNotice({ kind: 'error', text: error.message }),
    onSettled: () => setPhase('idle'),
  })

  const form = useForm({
    defaultValues: { photo: null as File | null },
    onSubmit: async ({ value }) => {
      if (!value.photo || busy) return
      if (session.sdk && session.viewer && !session.viewer.signedIn) {
        await session.sdk.login()
        const ready = await session.sdk.ready()
        setSession(previous => ({ ...previous, ...ready }))
        return
      }
      setNotice(null)
      await upload.mutateAsync(value.photo).catch(() => undefined)
    },
  })

  function selectFile(file?: File) {
    if (!file || busy) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setNotice({ kind: 'error', text: '请选择 JPG、PNG 或 WebP 图片' }); return
    }
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      setNotice({ kind: 'error', text: '图片大小需在 0–4 MiB 之间，请换一张或先压缩' }); return
    }
    form.setFieldValue('photo', file)
    setFileMeta({ name: file.name, size: file.size })
    setPreview(URL.createObjectURL(file))
    idempotency.current = crypto.randomUUID()
    setNotice(null)
    setResult(null)
  }

  function clearFile() {
    if (busy) return
    form.reset()
    setPreview(null)
    setFileMeta(null)
    setResult(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function submitResult() {
    if (!session.sdk || !result || busy || submissionBlocked) return
    setPhase('submitting')
    setNotice(null)
    try {
      const receipt = await session.sdk.submit(result.id)
      if (!receipt.judged) {
        if (receipt.reason === 'unconfirmed') setSubmissionBlocked(true)
        setNotice({ kind: 'info', text: receipt.reason === 'unconfirmed'
          ? '提交结果尚未确认，请到红包页查看领取记录。为避免重复操作，这里不会再次提交。'
          : receipt.message || (receipt.seconds ? `请等待 ${receipt.seconds} 秒后，再提交这次结果，无需重新上传` : '暂时无法提交，请回到红包页查看状态') })
      } else {
        if (receipt.claimed || receipt.settled) setSubmissionBlocked(true)
        setNotice({ kind: receipt.claimed ? 'success' : 'info', text: receipt.reply || (receipt.claimed ? `挑战完成，已领取 ${receipt.amount ?? ''} ${session.hongbao?.unit ?? 'LDC'}` : '结果已提交，请查看红包页的判定') })
      }
    } catch {
      setSubmissionBlocked(true)
      setNotice({ kind: 'info', text: '没有收到提交回应。请先查看红包页的领取记录，这里不会自动重试。' })
    } finally { setPhase('idle') }
  }

  const matched = result !== null && result.score >= challenge.minScore && result.score <= challenge.maxScore

  return <Layout>
    <main>
      <header className="page-intro">
        <p className="context-label">
          <span className="status-dot" data-connected={connected} aria-hidden="true" />
          {connected ? '本轮挑战' : '玩法预览'}
        </p>
        <h1 className="page-title">{challenge.challenge}</h1>
        <p className="page-description">选一张符合描述的图片，评分进入目标区间，即可提交结果领取红包。</p>
      </header>

      <div className="workspace">
        <section className="upload-section" aria-labelledby="upload-title">
          <div className="upload-header">
            <h2 id="upload-title" className="section-title">上传图片</h2>
            <span className="text-muted">单张不超过 4 MiB</span>
          </div>
          <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit() }}>
            <form.Field name="photo">{field => <>
              <input
                ref={inputRef} id="photo" name={field.name} type="file" tabIndex={-1}
                accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy}
                onBlur={field.handleBlur} onChange={event => selectFile(event.target.files?.[0])}
                aria-label="选择挑战图片"
              />
              <div
                className="upload-area" data-dragging={dragging} data-preview={Boolean(preview)}
                onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={event => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]) }}
              >
                {preview ? <>
                  <img src={preview} alt="你选择的挑战图片" className="upload-preview" />
                  <button type="button" disabled={busy} onClick={clearFile} className="remove-image" aria-label="移除图片"><X size={22} /></button>
                </> : <div className="upload-placeholder">
                  <ImagePlus size={48} strokeWidth={1.4} aria-hidden="true" />
                  <h3>选择一张图片</h3>
                  <p>拖放到这里，或从设备中选择</p>
                  <button type="button" className="button-primary mt-5" onClick={() => inputRef.current?.click()}>
                    选择图片<ArrowRight size={18} aria-hidden="true" />
                  </button>
                  <p className="mt-4">JPG、PNG、WebP</p>
                </div>}
              </div>
              {fileMeta && <div className="file-meta">
                <CheckCircle2 size={18} className="shrink-0 text-accent" aria-hidden="true" />
                <span className="min-w-0 truncate">{fileMeta.name}</span>
                <span className="ml-auto shrink-0">{(fileMeta.size / 1024 / 1024).toFixed(2)} MiB</span>
              </div>}
              {preview && <button type="button" className="text-action mt-2" disabled={busy} onClick={() => inputRef.current?.click()}>
                <RotateCcw size={18} aria-hidden="true" />换一张图片
              </button>}
            </>}</form.Field>

            <div className="upload-actions">
              <p className="upload-note"><LockKeyhole size={18} aria-hidden="true" />{challenge.saveImages ? '图片由红包作者私密保存' : '图片只用于评分，不保存'}</p>
              <form.Subscribe selector={state => state.values.photo}>{photo => <button
                type="submit" className="button-primary shrink-0"
                disabled={!photo || busy || !connected || exhausted || submissionBlocked || session.hongbao?.status !== 'active' || !config.data?.ownerConfigured}
              >
                {busy ? <LoaderCircle size={19} className="animate-spin" aria-hidden="true" /> : <Sparkles size={19} aria-hidden="true" />}
                {phase === 'identity' ? '正在验证身份' : phase === 'processing' ? '保存与评分中' : connected ? '上传并评分' : '请从红包页参与'}
                {!busy && <ArrowRight size={18} aria-hidden="true" />}
              </button>}</form.Subscribe>
            </div>
          </form>
          <p className="action-hint">每次开始评分会使用 1 次机会；处理失败也可能消耗机会。</p>
        </section>

        <aside className="challenge-rules" aria-label="本轮挑战规则">
          <section>
            <h2 className="font-medium">目标评分</h2>
            <p className="rule-value text-accent">{challenge.minScore}–{challenge.maxScore}%</p>
            <div className="score-band" aria-hidden="true">
              <span style={{ marginLeft: `${challenge.minScore}%`, width: `${Math.max(challenge.maxScore - challenge.minScore, 1)}%` }} />
            </div>
            <div className="score-axis" aria-hidden="true"><span>0%</span><span>100%</span></div>
            <p className="rule-detail">AI 判断图片与描述的匹配程度，分数落在这个区间内即符合要求。</p>
          </section>
          <section className="attempt-rule">
            <h2 className="font-medium">{remaining === null ? '上传机会' : '剩余机会'}</h2>
            <p className="rule-value">{remaining ?? challenge.maxAttempts}<small>次</small></p>
            <p className="rule-detail">每人最多 {challenge.maxAttempts} 次，选择合适的图片再开始评分。</p>
          </section>
        </aside>
      </div>

      <div className="feedback-section" aria-live="polite" aria-atomic="true">
        <AnimatePresence mode="wait">
          {phase === 'processing' && <motion.section key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="result-panel flex items-start gap-4">
            <LoaderCircle className="mt-1 shrink-0 animate-spin text-accent" size={26} aria-hidden="true" />
            <div><h2 className="section-title">正在处理这张图片</h2>
              <p className="mt-2 text-muted">{challenge.saveImages ? '图片保存和 AI 评分同时进行，请稍等片刻。' : 'AI 正在判断图片，评分完成后即可提交结果。'}</p>
            </div>
          </motion.section>}
          {result && phase !== 'processing' && <motion.section key={result.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="result-panel">
            <div className="flex flex-wrap items-center justify-between gap-5">
              <div><h2 className="font-medium">本次评分</h2><p className="result-score">{result.score.toFixed(1)}<small>%</small></p></div>
              <p className="result-status text-accent" data-matched={matched}>
                {matched && <CheckCircle2 size={22} aria-hidden="true" />}{matched ? '符合目标区间' : '未达到目标区间'}
              </p>
            </div>
            <p className="mt-5 text-muted">AI 评分仅作判定依据，最终奖励以红包站核验结果为准。</p>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
              <span className="text-muted">还可上传 {result.remaining} 次{result.saved ? ' · 图片已保存' : ''}</span>
              <button className="button-primary" disabled={busy || submissionBlocked} onClick={() => void submitResult()}>
                {phase === 'submitting' ? <LoaderCircle className="animate-spin" size={19} aria-hidden="true" /> : <Check size={19} aria-hidden="true" />}提交这次结果
              </button>
            </div>
          </motion.section>}
        </AnimatePresence>
        {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className="notice" data-kind={notice.kind}>
          <CircleHelp size={20} aria-hidden="true" /><span>{notice.text}</span>
        </div>}
        {session.status === 'standalone' && <div className="notice">
          <CircleHelp size={20} aria-hidden="true" /><p>当前是玩法预览，可以选择图片。正式参与时，请从红包页打开，系统会带入挑战规则和你的身份。</p>
        </div>}
        {session.error && <p role="alert" className="notice" data-kind="error">{session.error}</p>}
        {config.isError && <p role="alert" className="notice" data-kind="error">服务配置暂时无法读取，请刷新页面。</p>}
        {config.data && !config.data.ownerConfigured && <p className="notice">服务还未设置作者 ID。部署者请先完成设置，玩家暂时无法上传。</p>}
      </div>

      <section className="instructions" id="how-to-play">
        <button className="instructions-toggle" onClick={() => setInstructions(!instructions)} aria-expanded={instructions} aria-controls="instructions">
          <span>怎么玩</span><ChevronDown size={22} className={`text-muted transition-transform ${instructions ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        <div id="instructions" hidden={!instructions}>
          <ol className="instruction-steps">
            {[
              ['选择图片', '根据挑战描述，上传一张照片或截图。'],
              ['查看评分', `AI 给出匹配分数，目标是 ${challenge.minScore}–${challenge.maxScore}%。`],
              ['提交结果', '点击提交，由红包站核验并发放奖励。'],
            ].map(([title, detail], index) => <li key={title} className="instruction-step">
              <span className="step-number" aria-hidden="true">{index + 1}</span>
              <div><h3>{title}</h3><p>{detail}</p></div>
            </li>)}
          </ol>
        </div>
      </section>
    </main>
  </Layout>
}
