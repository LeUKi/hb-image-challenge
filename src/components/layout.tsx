import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Image } from 'lucide-react'

export function Layout({ children }: { children: ReactNode }) {
  return <div className="site-shell">
    <header className="site-header">
      <Link to="/" className="site-brand" aria-label="图片挑战首页">
        <span className="brand-icon"><Image size={22} strokeWidth={1.8} aria-hidden="true" /></span>
        <span>图片挑战</span>
      </Link>
      <nav aria-label="主导航">
        <Link to="/setup" className="header-link">部署自己的服务<ArrowUpRight size={18} aria-hidden="true" /></Link>
      </nav>
    </header>
    {children}
    <footer className="site-footer">
      <span>图片挑战</span>
      <a href="https://github.com/LeUKi/hb-image-challenge" target="_blank" rel="noreferrer">查看源码<ArrowUpRight size={18} aria-hidden="true" /></a>
    </footer>
  </div>
}
