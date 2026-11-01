import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EyeOff, ImageOff, Images, LoaderCircle, RefreshCw } from 'lucide-react'
import { assignGalleryColumns, captureGalleryAnchor, isCovered, releaseGalleryAnchorSpace, restoreGalleryAnchor } from '../lib/gallery'
import type { GalleryAnchor } from '../lib/gallery'
import { PrivateImageCache } from '../lib/private-images'
import type { GalleryItem } from '../shared/contracts'
import { Modal } from './modal'

function PrivateImage({ item, cache, eager = false }: { item: GalleryItem; cache: PrivateImageCache; eager?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [image, setImage] = useState<{ url?: string; error?: string }>({})
  useEffect(() => {
    let disposed = false
    let observer: IntersectionObserver | null = null
    const load = () => {
      observer?.disconnect()
      void cache.get(item.id).then(url => { if (!disposed) setImage({ url }) }).catch(error => {
        if (!disposed) setImage({ error: error instanceof Error ? error.message : '图片暂时无法读取' })
      })
    }
    if (eager || !('IntersectionObserver' in window)) load()
    else {
      observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) load() }, { rootMargin: '400px' })
      if (ref.current) observer.observe(ref.current)
    }
    return () => { disposed = true; observer?.disconnect() }
  }, [item.id, cache, eager])
  return <span className="private-image" ref={ref}>
    {image.url ? <img src={image.url} alt="挑战作品" width={item.width ?? 600} height={item.height ?? 800} decoding="async" />
      : image.error ? <span className="image-placeholder"><ImageOff size={24} aria-hidden="true" /><span>{image.error}</span></span>
        : <span className="image-placeholder" aria-label="图片加载中"><Images size={28} strokeWidth={1.4} aria-hidden="true" /></span>}
  </span>
}

export function Gallery({ items, next, visibility, isLoading, isRefreshing, error, loadingMore, onLoadMore, onRefresh, showNsfw, getHeaders }: {
  items: GalleryItem[]; next: string | null; visibility: 'misses' | 'all'; isLoading: boolean; isRefreshing: boolean
  error: string | null; loadingMore: boolean; onLoadMore: () => void; onRefresh: () => void
  showNsfw: boolean; getHeaders: () => Promise<Headers>
}) {
  const root = useRef<HTMLDivElement>(null)
  const anchor = useRef<GalleryAnchor | null>(null)
  const [layout, setLayout] = useState(() => {
    const assignments = new Map<string, number>()
    return { items, assignments, columns: assignGalleryColumns(items, assignments) }
  })
  const [revealed, setRevealed] = useState(new Set<string>())
  const [selected, setSelected] = useState<GalleryItem | null>(null)
  const [cache] = useState(() => new PrivateImageCache(getHeaders))
  useLayoutEffect(() => { cache.updateHeaders(getHeaders) }, [cache, getHeaders])
  useEffect(() => () => cache.dispose(), [cache])
  useEffect(() => {
    const releaseSpace = () => { if (root.current) releaseGalleryAnchorSpace(root.current) }
    window.addEventListener('scroll', releaseSpace, { passive: true })
    return () => window.removeEventListener('scroll', releaseSpace)
  }, [])
  useLayoutEffect(() => {
    if (layout.items === items) return
    anchor.current = root.current ? captureGalleryAnchor(root.current) : null
    const assignments = new Map(layout.assignments)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Preserve old DOM geometry, then restore its visible anchor in the following layout commit.
    setLayout({ items, assignments, columns: assignGalleryColumns(items, assignments) })
  }, [items, layout])
  useLayoutEffect(() => {
    if (root.current && anchor.current) { restoreGalleryAnchor(root.current, anchor.current); anchor.current = null }
  }, [layout])
  const { columns } = layout
  const reveal = (id: string) => setRevealed(previous => new Set(previous).add(id))
  const selectedCovered = selected ? isCovered(selected, showNsfw, revealed.has(selected.id)) : false

  return <section className="gallery-section" aria-labelledby="gallery-title" ref={root}>
    <div className="gallery-heading"><h2 id="gallery-title">本轮作品</h2><button type="button" className="icon-button" onClick={onRefresh} disabled={isRefreshing} aria-label="刷新作品">
      <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true" /></button></div>
    <p className="gallery-description">{visibility === 'all' ? '已解锁本轮全部评分记录。' : '先看未达标作品；领取成功或活动结束后解锁全部。'}</p>
    <div className="gallery-live" aria-live="polite" aria-atomic="true"><span className="sr-only">已显示 {items.length} 条评分记录，新作品会自动更新。</span></div>
    {layout.items.length ? <div className="gallery-columns">{columns.map((column, index) => <div className="gallery-column" key={index}>
      {column.map(item => {
        const covered = isCovered(item, showNsfw, revealed.has(item.id))
        return <article className="gallery-item" key={item.id} data-gallery-id={item.id}>
          {item.saved ? <button type="button" className="gallery-photo" style={{ aspectRatio: `${item.width ?? 3} / ${item.height ?? 4}` }} data-covered={covered}
            aria-label={covered ? 'NSFW，点击查看图片' : `查看评分 ${item.score.toFixed(1)}% 的图片`} onClick={() => covered ? reveal(item.id) : setSelected(item)}>
            <PrivateImage item={item} cache={cache} />
            {covered && <span className="nsfw-cover"><EyeOff size={24} aria-hidden="true" /><strong>NSFW</strong><span>点击查看</span></span>}
            <span className="gallery-score" data-passed={item.passed}>{item.score.toFixed(1)}%</span>
          </button> : <button type="button" className="score-only-record" onClick={() => setSelected(item)} aria-label={`查看评分 ${item.score.toFixed(1)}% 的记录`}>
            <ImageOff size={24} aria-hidden="true" /><strong data-passed={item.passed}>{item.score.toFixed(1)}%</strong><span>仅评分记录</span>
          </button>}
        </article>
      })}
    </div>)}</div> : <div className="gallery-empty">
      {isLoading ? <LoaderCircle className="animate-spin" size={28} aria-hidden="true" /> : <Images size={32} strokeWidth={1.4} aria-hidden="true" />}
      <p>{isLoading ? '正在读取本轮作品' : '还没有可展示的评分记录'}</p>
      <p>最新作品会自动显示在这里。</p>
    </div>}
    {error && <div className="notice" role="status"><p>{error}</p><button type="button" className="text-action" onClick={onRefresh}>重新读取</button></div>}
    {next && <button type="button" className="button-secondary load-more" disabled={loadingMore} onClick={onLoadMore}>
      {loadingMore && <LoaderCircle className="animate-spin" size={18} aria-hidden="true" />}{loadingMore ? '正在加载' : '加载更早作品'}
    </button>}
    <Modal open={Boolean(selected)} title={selected?.saved ? '图片详情' : '评分记录'} onClose={() => setSelected(null)} wide>
      {selected && <>
        {selected.saved ? <button className="detail-photo" type="button" data-covered={selectedCovered} disabled={!selectedCovered} onClick={() => reveal(selected.id)}
          style={{ aspectRatio: `${selected.width ?? 3} / ${selected.height ?? 4}` }} aria-label={selectedCovered ? 'NSFW，点击查看图片' : '挑战作品'}>
          <PrivateImage item={selected} cache={cache} eager />
          {selectedCovered && <span className="nsfw-cover"><EyeOff size={26} aria-hidden="true" /><strong>NSFW</strong><span>点击查看</span></span>}
        </button> : <p className="text-muted">本次只保存评分记录，没有保存图片。</p>}
        <div className="image-detail-score"><span>匹配评分</span><strong data-passed={selected.passed}>{selected.score.toFixed(1)}%</strong></div>
        <p className="text-muted">Clef Omni · Cloudflare Workers AI</p>
        {selected.nsfwScore === null && <p className="text-muted mt-3">未取得敏感提示分，默认遮罩展示。</p>}
      </>}
    </Modal>
  </section>
}
