import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { ArrowRight, Check, Copy, Database, ExternalLink, HardDrive, ShieldCheck, Sparkles } from 'lucide-react'
import { Layout } from '../components/layout'

export const Route = createFileRoute('/setup')({
  head: () => ({ meta: [{ title: '部署你自己的图片挑战 · 见图' }] }),
  component: SetupPage,
})

const DEPLOY_URL = 'https://deploy.workers.cloudflare.com/?url=https://github.com/LeUKi/hb-image-challenge'

function SetupPage() {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const form = useForm({
    defaultValues: { ownerId: '' },
    onSubmit: async ({ value }) => {
      try {
        await navigator.clipboard.writeText(`OWNER_ID=${value.ownerId.trim()}\nHB_SITE=https://hb.lafi.sh\n`)
        setCopied(true)
        setCopyError('')
      } catch { setCopyError('复制未完成，请手动把下方数字 ID 填入 Cloudflare 的 OWNER_ID 变量。') }
    },
  })

  return <Layout><main className="mx-auto max-w-3xl pb-5 pt-12 max-sm:pt-9">
    <p className="eyebrow mb-4">MAKE IT YOURS</p><h1 className="text-3xl font-semibold tracking-tight">你的挑战，你的服务。</h1><p className="mt-4 text-sm leading-8 text-slate-500">把网页、AI 和图片存储，一起部署到你自己的 Cloudflare 账号。<br className="max-sm:hidden" />所有图片与用量都归你管理，无需向我们提供 API 密钥。</p>

    <section className="panel mt-8 p-7 max-sm:p-5"><h2 className="text-sm font-semibold">一次部署，包含完整能力</h2><div className="my-7 grid grid-cols-3 gap-4 max-sm:grid-cols-1">{[[Sparkles, 'AI 评分', '固定使用 Clef Omni 模型'], [HardDrive, '图片保存', '私有 R2，按红包选择是否保存'], [Database, '结果记录', 'D1 保存次数与核验结果']].map(([Icon, title, text]) => { const Glyph = Icon as typeof Sparkles; return <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4" key={String(title)}><Glyph size={18} className="mb-3 text-accent" /><h3 className="text-xs font-semibold">{String(title)}</h3><p className="mt-2 text-[11px] leading-5 text-slate-400">{String(text)}</p></div> })}</div><a className="button-primary" href={DEPLOY_URL} target="_blank" rel="noreferrer">Deploy to Cloudflare<ExternalLink size={14} /></a><p className="mt-4 text-xs leading-6 text-slate-400">登录 Cloudflare 并连接 GitHub，确认 Worker、R2 和 D1 的资源名称后部署。首次使用 R2 时按 Cloudflare 提示完成账户设置。</p></section>

    <ol className="mt-8 space-y-7">
      <li className="rule-row"><span className="step-number">01</span><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">设置你的作者 ID</h2><p className="mt-2 text-xs leading-6 text-slate-500">在 Cloudflare 的 Worker → Settings → Variables and Secrets，将 <code>OWNER_ID</code> 设为你自己的 LINUX DO 数字用户 ID。这个服务只处理你发出的红包。</p><form className="mt-4" onSubmit={event => { event.preventDefault(); void form.handleSubmit() }}><form.Field name="ownerId" validators={{ onChange: ({ value }) => /^\d{1,20}$/.test(value.trim()) ? undefined : '请输入 LINUX DO 数字 ID' }}>{field => <div><label htmlFor="owner-id" className="field-label">LINUX DO 数字 ID</label><input className="text-input max-w-xs" id="owner-id" name={field.name} inputMode="numeric" placeholder="例如 10000" value={field.state.value} onChange={event => { field.handleChange(event.target.value); setCopied(false) }} onBlur={field.handleBlur} aria-describedby="owner-error" />{field.state.meta.isTouched && field.state.meta.errors.length > 0 && <p id="owner-error" className="mt-2 text-xs text-rose-600">{field.state.meta.errors.join('，')}</p>}</div>}</form.Field><form.Subscribe selector={state => [state.canSubmit, state.values.ownerId] as const}>{([canSubmit, ownerId]) => <button type="submit" disabled={!canSubmit || !/^\d{1,20}$/.test(ownerId.trim())} className="button-secondary mt-3">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制本地开发配置' : '复制本地开发配置'}</button>}</form.Subscribe>{copyError && <p role="alert" className="mt-2 text-xs text-rose-600">{copyError}</p>}</form></div></li>
      <li className="rule-row"><span className="step-number">02</span><div><h2 className="text-sm font-semibold">在红包站使用图片挑战判定器</h2><p className="mt-2 text-xs leading-6 text-slate-500">填写部署后得到的服务地址，例如 <code className="break-all">https://你的服务.workers.dev/</code>。然后设置挑战描述、评分区间、每人次数和是否保存图片。每人最多 10 次，默认 3 次。</p></div></li>
      <li className="rule-row"><span className="step-number">03</span><div><h2 className="text-sm font-semibold">开放红包，邀请大家来试</h2><p className="mt-2 text-xs leading-6 text-slate-500">玩家在附带网页上传图片，服务并行保存和评分。玩家提交结果编号后，判定器会向你的服务核验，符合范围再发奖。</p></div></li>
    </ol>

    <div className="mt-8 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/60 p-5"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" /><p className="text-xs leading-7 text-slate-500">AI、R2、数据库的使用量计入你的 Cloudflare 账号。保存的图片默认私有，其他玩家不能凭结果编号读取。模型评分是判断依据，不代表经过校准的真实概率。</p></div>
    <a href="https://github.com/LeUKi/hb-image-challenge#readme" target="_blank" rel="noreferrer" className="mt-7 inline-flex items-center gap-2 text-xs text-accent">查看部署说明与源码<ArrowRight size={13} /></a>
  </main></Layout>
}
