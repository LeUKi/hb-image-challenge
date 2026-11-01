import { useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiJson } from './hongbao'
import { mergeGalleryItems } from './gallery'
import type { GalleryItem, GalleryResponse } from '../shared/contracts'

interface GalleryState { scope: string; items: GalleryItem[]; next: string | null; visibility: 'misses' | 'all' }

export function useGallery({ scope, grant, enabled, getHeaders }: {
  scope: string
  grant: string | null
  enabled: boolean
  getHeaders: () => Promise<Headers>
}) {
  const [state, setState] = useState<GalleryState>({ scope: '', items: [], next: null, visibility: 'misses' })
  const [loadingMore, setLoadingMore] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [lastData, setLastData] = useState<GalleryResponse | null>(null)
  const current = useRef(state)
  const currentScope = useRef(scope)
  useLayoutEffect(() => { current.current = state; currentScope.current = scope }, [state, scope])
  const latest = useQuery({
    queryKey: ['gallery', scope, grant],
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const headers = await getHeaders()
      const first = await apiJson<GalleryResponse>('/api/gallery', { headers, signal })
      const previous = current.current.scope === scope ? current.current : null
      const known = new Set(previous?.items.map(item => item.id))
      let items = first.items
      let next = first.next
      const seen = new Set<string>()
      // Fill a busy interval, rather than silently skipping images beyond the first page.
      while (known.size && items.length && !items.some(item => known.has(item.id)) && next && !seen.has(next)) {
        seen.add(next)
        const page = await apiJson<GalleryResponse>(`/api/gallery?cursor=${encodeURIComponent(next)}`, { headers, signal })
        items = mergeGalleryItems(items, page.items)
        next = page.next
      }
      return { ...first, items, next }
    },
  })

  if (latest.data && lastData !== latest.data) {
    const data = latest.data
    setLastData(data)
    setState(previous => {
      const sameScope = previous.scope === scope
      const restricted = previous.visibility === 'all' && data.visibility === 'misses'
      const keep = sameScope && !restricted
      return { scope, items: mergeGalleryItems(keep ? previous.items : [], data.items),
        next: keep && previous.items.length && previous.visibility === data.visibility ? previous.next : data.next, visibility: data.visibility }
    })
  }

  async function loadMore() {
    if (loadingMore || state.scope !== scope || !state.next) return
    setLoadingMore(true)
    setPageError(null)
    const cursor = state.next
    try {
      const headers = await getHeaders()
      const page = await apiJson<GalleryResponse>(`/api/gallery?cursor=${encodeURIComponent(cursor)}`, { headers })
      if (currentScope.current !== scope) return
      setState(previous => ({ scope, items: mergeGalleryItems(previous.scope === scope && !(previous.visibility === 'all' && page.visibility === 'misses') ? previous.items : [], page.items), next: page.next, visibility: page.visibility }))
    } catch (error) { setPageError(error instanceof Error ? error.message : '旧作品暂时无法加载') }
    finally { setLoadingMore(false) }
  }

  return {
    items: enabled && state.scope === scope ? state.items : [],
    next: enabled && state.scope === scope ? state.next : null,
    visibility: state.scope === scope ? state.visibility : 'misses' as const,
    latest: latest.data?.latest ?? null,
    remaining: latest.data?.remaining ?? null,
    isLoading: enabled && latest.isPending,
    isRefreshing: latest.isFetching,
    error: pageError ?? (latest.isError ? latest.error.message : null),
    loadingMore, loadMore, refresh: latest.refetch,
  }
}
