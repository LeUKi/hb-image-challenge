import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from '@tanstack/react-form'
import { useAtom } from 'jotai'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Check, CheckCircle2, ChevronDown, CircleHelp, ImagePlus, LoaderCircle, LockKeyhole, RotateCcw, ShieldCheck, Sparkles, Upload, X } from 'lucide-react'
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

  return <Layout>
    <section className="flex items-end justify-between gap-6 pb-9 pt-12 max-sm:pb-7 max-sm:pt-9">
      <div><p className="eyebrow mb-4">A LITTLE IMAGE CHALLENGE</p><h1 className="text-[38px] font-semibold leading-tight tracking-[-.045em] max-sm:text-[30px]">让图片，来回答<span className="text-accent">。</span></h1><p className="mt-4 text-[13px] leading-7 text-slate-500">选一张合适的图片，让 AI 看看它有多符合挑战。</p></div>
      <span className="mb-1 hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-500 sm:flex"><span className={`size-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />{connected ? '已连接红包' : '玩法预览'}</span>
    </section>

    <section className="panel mb-5 hidden p-5 max-md:block" aria-label="本轮挑战规则"><p className="eyebrow mb-2">{connected ? '本轮挑战' : '示例规则'}</p><h2 className="text-base font-semibold leading-7">{challenge.challenge}</h2><div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs"><span className="font-medium text-accent">目标 {challenge.minScore}%—{challenge.maxScore}%</span><span className="text-slate-500">{remaining ?? challenge.maxAttempts} 次{remaining === null ? '机会' : '剩余'}</span></div></section>
    <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-6 max-md:grid-cols-1">
      <main className="min-w-0 space-y-5">
        <section className="panel p-7 max-sm:p-5" aria-labelledby="upload-title">
          <div className="mb-6 flex items-center justify-between gap-3"><h2 id="upload-title" className="flex items-center gap-2.5 text-sm font-semibold"><span className="flex size-7 items-center justify-center rounded-lg bg-blue-50 text-accent"><ImagePlus size={16} /></span>上传你的答案</h2><span className="text-[11px] text-slate-400">单张图片 · 最高 4 MiB</span></div>
          <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit() }}>
            <form.Field name="photo">{field => <>
              <input ref={inputRef} id="photo" name={field.name} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onBlur={field.handleBlur} onChange={event => selectFile(event.target.files?.[0])} aria-label="选择挑战图片" />
              <div className="upload-area relative flex min-h-[300px] items-center justify-center overflow-hidden max-sm:min-h-[260px]" data-dragging={dragging} onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); selectFile(event.dataTransfer.files[0]) }}>
                {preview ? <>
                  <img src={preview} alt="你选择的挑战图片" className="max-h-[360px] w-full object-contain p-4" />
                  <button type="button" disabled={busy} onClick={clearFile} className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-500 shadow-sm" aria-label="移除图片"><X size={16} /></button>
                </> : <div className="px-5 py-10 text-center">
                  <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-[20px] border border-white bg-white text-[#899bd3] shadow-[0_5px_24px_#d6def066]"><Upload size={27} strokeWidth={1.5} /></div>
                  <p className="text-sm font-medium">把图片拖到这里</p><p className="mb-5 mt-2 text-xs text-slate-400">或从相册里，选一个答案</p>
                  <button type="button" className="button-secondary !min-h-10 !px-5" onClick={() => inputRef.current?.click()}>选择图片<ArrowRight size={13} /></button>
                  <p className="mt-5 text-[10px] tracking-wide text-slate-400">JPG / PNG / WEBP</p>
                </div>}
              </div>
              {fileMeta && <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-slate-400"><CheckCircle2 size={13} className="shrink-0 text-accent" /><span className="truncate">{fileMeta.name}</span><span className="ml-auto shrink-0">{(fileMeta.size / 1024 / 1024).toFixed(2)} MiB</span></div>}
            </>}</form.Field>

            <div className="mt-5 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
              <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><LockKeyhole size={12} />{challenge.saveImages ? '图片由红包作者私密保存' : '图片只用于本次评分，不持久保存'}</p>
              <form.Subscribe selector={state => state.values.photo}>{photo => <button type="submit" className="button-primary shrink-0" disabled={!photo || busy || !connected || exhausted || submissionBlocked || session.hongbao?.status !== 'active' || !config.data?.ownerConfigured}>
                {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Sparkles size={15} />}{phase === 'identity' ? '正在验证身份' : phase === 'processing' ? '保存与评分中' : connected ? '上传并评分' : '请从红包页参与'}{!busy && <ArrowRight size={14} />}
              </button>}</form.Subscribe>
            </div>
          </form>
          <p className="mt-4 text-[10px] leading-5 text-slate-400">开始评分后会使用一次机会；服务异常也可能已使用 AI 额度。刷新或重复点击不会自动重新评分。</p>
        </section>

        <div aria-live="polite" aria-atomic="true">
          <AnimatePresence mode="wait">
            {phase === 'processing' && <motion.section key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="panel flex items-center gap-4 p-6"><LoaderCircle className="animate-spin text-accent" size={22} /><div><p className="text-sm font-medium">正在处理这张图片</p><p className="mt-1 text-xs leading-6 text-slate-500">{challenge.saveImages ? '图片保存和 AI 评分同时进行，请稍等片刻。' : 'AI 正在判断图片，评分完成后即可提交结果。'}</p></div></motion.section>}
            {result && phase !== 'processing' && <motion.section key={result.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="panel p-6">
              <div className="flex items-center justify-between gap-4"><div><p className="eyebrow">本次评分</p><p className="mt-2 text-[40px] font-semibold leading-none tracking-tight text-accent">{result.score.toFixed(1)}<span className="ml-1 text-base font-normal text-slate-400">%</span></p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] text-slate-500">{result.score >= challenge.minScore && result.score <= challenge.maxScore ? '落在挑战区间' : '尚未落在区间'}</span></div>
              <p className="mt-4 text-xs leading-6 text-slate-500">这个分数表示 AI 认为图片符合挑战描述的可能性。最终奖励以红包站判定为准。</p>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><span className="text-xs text-slate-400">还可上传 {result.remaining} 次{result.saved ? ' · 图片已保存' : ''}</span><button className="button-primary" disabled={busy || submissionBlocked} onClick={() => void submitResult()}>{phase === 'submitting' ? <LoaderCircle className="animate-spin" size={14} /> : <Check size={15} />}提交这次结果</button></div>
            </motion.section>}
          </AnimatePresence>
          {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-2xl border px-5 py-4 text-xs leading-6 ${notice.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : notice.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-blue-100 bg-blue-50 text-blue-800'}`}>{notice.text}</div>}
          {session.status === 'standalone' && <div className="flex items-start gap-2.5 px-1 py-1 text-xs leading-6 text-slate-400"><CircleHelp className="mt-1 shrink-0" size={14} /><span>这里可以预览玩法和选择图片。正式参与时，请从红包页打开，系统会自动带入挑战规则和你的身份。</span></div>}
          {session.error && <p role="alert" className="text-xs text-rose-600">{session.error}</p>}
          {config.isError && <p role="alert" className="mt-3 text-xs text-rose-600">服务配置暂时无法读取，请刷新页面。</p>}
          {config.data && !config.data.ownerConfigured && <p className="mt-3 text-xs leading-6 text-slate-500">服务还未设置作者 ID。部署者请先完成设置，玩家暂时无法上传。</p>}
        </div>
      </main>

      <aside className="space-y-5">
        <section className="panel hidden overflow-hidden md:block" aria-labelledby="challenge-title">
          <div className="border-b border-slate-100 p-6"><div className="mb-4 flex items-center justify-between"><p className="eyebrow">CURRENT CHALLENGE</p><span className="rounded-md bg-blue-50 px-2 py-1 text-[10px] text-accent">{connected ? '本轮挑战' : '示例规则'}</span></div><h2 id="challenge-title" className="text-lg font-semibold leading-8 tracking-tight">{challenge.challenge}</h2><p className="mt-2 text-xs leading-6 text-slate-400">上传符合描述的图片，试着落在指定的评分区间。</p></div>
          <div className="space-y-5 p-6"><div><div className="mb-3 flex items-center justify-between"><span className="text-xs text-slate-500">目标区间</span><span className="text-sm font-semibold tabular-nums text-accent">{challenge.minScore}%—{challenge.maxScore}%</span></div><div className="score-band"><span style={{ marginLeft: `${challenge.minScore}%`, width: `${Math.max(challenge.maxScore - challenge.minScore, 1)}%` }} /></div><div className="mt-2 flex justify-between text-[9px] text-slate-400"><span>0%</span><span>100%</span></div></div><div className="flex items-center justify-between border-t border-slate-100 pt-4"><span className="text-xs text-slate-500">每人上传机会</span><span className="text-sm font-semibold">{remaining ?? challenge.maxAttempts}<span className="ml-1 text-xs font-normal text-slate-400">{remaining !== null ? '次剩余' : '次'}</span></span></div></div>
        </section>
        <section className="rounded-2xl border border-slate-200/80 px-6 py-5" id="how-to-play">
          <button className="flex w-full items-center justify-between text-xs font-semibold" onClick={() => setInstructions(!instructions)} aria-expanded={instructions} aria-controls="instructions"><span className="flex items-center gap-2"><CircleHelp size={14} className="text-slate-400" />怎么玩</span><ChevronDown size={14} className={`text-slate-400 transition-transform ${instructions ? 'rotate-180' : ''}`} /></button>
          <div id="instructions" hidden={!instructions}><ol className="mt-5 space-y-5">{[['选一张图片', '照片、截图或相册里的图片都可以。'], ['等待 AI 评分', '同一次上传的结果会被保存，无需反复提交图片。'], ['提交结果', '分数符合规则，就由红包站核验并发奖。']].map(([title, detail], index) => <li key={title} className="rule-row"><span className="step-number">0{index + 1}</span><div><p className="text-xs font-medium">{title}</p><p className="mt-1 text-[11px] leading-5 text-slate-400">{detail}</p></div></li>)}</ol></div>
        </section>
        <p className="flex items-start gap-2 px-1 text-[10px] leading-5 text-slate-400"><ShieldCheck className="mt-0.5 shrink-0" size={13} /><span>上传前请确认你有权使用这张图片，避免包含个人敏感信息。</span></p>
        {preview && !busy && !exhausted && <button className="flex items-center gap-1.5 px-1 text-xs text-slate-400 hover:text-slate-600" onClick={() => inputRef.current?.click()}><RotateCcw size={12} />换一张图片</button>}
      </aside>
    </div>
  </Layout>
}
