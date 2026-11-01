import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Focus } from 'lucide-react'

export function Layout({ children }: { children: ReactNode }) {
  return <div className="site-shell">
    <header className="flex h-24 items-center justify-between gap-5 border-b border-slate-200/70 max-sm:h-20">
      <Link to="/" className="flex items-center gap-3 no-underline" aria-label="见图首页">
        <span className="flex size-10 items-center justify-center rounded-[13px] bg-white text-accent shadow-sm ring-1 ring-slate-200/80"><Focus size={23} strokeWidth={1.6} /></span>
        <span className="text-lg font-semibold tracking-[.1em]">见图<span className="ml-3 border-l border-slate-300 pl-3 text-xs font-normal tracking-normal text-slate-400 max-sm:hidden">图片挑战</span></span>
      </Link>
      <Link to="/setup" className="flex items-center gap-1.5 text-xs text-slate-500 transition hover:text-accent">部署自己的服务<ArrowUpRight size={14} /></Link>
    </header>
    {children}
    <footer className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 py-7 text-[11px] leading-6 text-slate-400">
      <span>一张图片，一个新的可能。</span>
      <a className="inline-flex items-center gap-1 hover:text-slate-600" href="https://github.com/LeUKi/hb-image-challenge" target="_blank" rel="noreferrer">开源图片挑战<ArrowUpRight size={12} /></a>
    </footer>
  </div>
}
