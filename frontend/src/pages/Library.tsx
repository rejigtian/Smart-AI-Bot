import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { fetchSuites, fetchAllNodes, fetchNodeContext } from '../lib/api'

const PAGE = 50

// Right-hand detail: the selected node's parent, children, and referrers.
function NodeContextPanel({ nodeId }: { nodeId: string }) {
  const navigate = useNavigate()
  const { data: ctx, isLoading } = useQuery({
    queryKey: ['node-context', nodeId],
    queryFn: () => fetchNodeContext(nodeId),
  })
  if (isLoading || !ctx) return <div className="p-4 text-sm text-gray-400">加载中…</div>
  return (
    <div className="p-4 space-y-4 text-sm">
      <div>
        <div className="text-xs text-gray-500 mb-1">完整路径 · {ctx.suite_name}</div>
        <div className="font-mono text-xs break-words">{ctx.path}</div>
      </div>

      <div>
        <div className="text-xs text-gray-500 mb-1">上一级（父步骤）</div>
        {ctx.parent
          ? <div className="px-2 py-1 rounded bg-gray-50">{ctx.parent.action}
              {ctx.parent.expected && <span className="text-blue-600 text-xs"> · 期望:{ctx.parent.expected}</span>}</div>
          : <div className="text-gray-400 text-xs">（根步骤，无父）</div>}
      </div>

      <div>
        <div className="text-xs text-gray-500 mb-1">子步骤（{ctx.children.length}）</div>
        {ctx.children.length === 0 && <div className="text-gray-400 text-xs">（叶子，无子步骤）</div>}
        {ctx.children.map(c => (
          <div key={c.node_id} className="px-2 py-1 rounded hover:bg-gray-50 border-t">
            {c.action}{c.expected && <span className="text-blue-600 text-xs"> · 期望:{c.expected}</span>}
          </div>
        ))}
      </div>

      {ctx.reuses && (
        <div>
          <div className="text-xs text-gray-500 mb-1">复用自 / 源</div>
          <button className="w-full text-left px-2 py-1 rounded hover:bg-gray-50 border text-xs"
                  onClick={() => navigate(`/suites/${ctx.reuses!.suite_id}`)}>
            <span className={`px-1.5 py-0.5 rounded mr-2 ${ctx.reuses.kind === 'link' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
              {ctx.reuses.kind === 'link' ? '活链接（改源会同步）' : '快照拷贝（改源不影响）'}
            </span>
            <span className="font-mono">{ctx.reuses.path}</span>
            <span className="text-gray-400"> · {ctx.reuses.suite_name}</span>
          </button>
        </div>
      )}

      <div>
        <div className="text-xs text-gray-500 mb-1">被复用 / 引用方（{ctx.referrers.length}）</div>
        {ctx.referrers.length === 0 && <div className="text-gray-400 text-xs">（还没有被复用）</div>}
        {ctx.referrers.map(r => (
          <button key={r.node_id} className="w-full text-left px-2 py-1 rounded hover:bg-gray-50 border-t text-xs"
                  onClick={() => navigate(`/suites/${r.suite_id}`)}>
            <span className={`px-1.5 py-0.5 rounded mr-2 ${r.kind === 'link' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
              {r.kind === 'link' ? '活链接' : '快照拷贝'}
            </span>
            <span className="font-mono">{r.path}</span>
            <span className="text-gray-400"> · {r.suite_name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Library() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [suiteId, setSuiteId] = useState('')
  const [showDerived, setShowDerived] = useState(false)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  const { data: suites = [] } = useQuery({ queryKey: ['suites'], queryFn: fetchSuites })
  const { data, isFetching } = useQuery({
    queryKey: ['nodes-all', q, suiteId, showDerived, page],
    queryFn: () => fetchAllNodes({ q: q.trim(), suite_id: suiteId, include_derived: showDerived, offset: page * PAGE, limit: PAGE }),
    placeholderData: keepPreviousData,
  })
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const reset = () => setPage(0)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">用例库</h1>
      <p className="text-sm text-gray-500 mb-4">全库步骤节点 · 选中看上级/子级/引用方 · 编辑流程会同步到所有「活链接」引用方</p>

      <div className="flex gap-2 mb-3">
        <input
          className="flex-1 border rounded px-3 py-2 text-sm"
          placeholder="搜索行为或期望，如「登录」「语音」「点赞」"
          value={q}
          onChange={e => { setQ(e.target.value); reset() }}
        />
        <select className="border rounded px-2 text-sm" value={suiteId}
                onChange={e => { setSuiteId(e.target.value); reset() }}>
          <option value="">全部套件</option>
          {suites.map(s => <option key={s.id} value={s.id}>{(s.name || '').replace(/\.xmind$/i, '')}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-ink-mute whitespace-nowrap cursor-pointer">
          <input type="checkbox" checked={showDerived} onChange={e => { setShowDerived(e.target.checked); reset() }} />
          显示拷贝/链接副本
        </label>
      </div>

      <div className="flex gap-4 items-start">
        {/* Left: flat paginated node list */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>{total} 个节点{isFetching ? ' · 加载中…' : ''}</span>
            <span className="flex items-center gap-2">
              <button disabled={page <= 0} className="px-2 py-0.5 border rounded disabled:opacity-40"
                      onClick={() => setPage(p => Math.max(0, p - 1))}>‹ 上一页</button>
              <span>{page + 1} / {pages}</span>
              <button disabled={page >= pages - 1} className="px-2 py-0.5 border rounded disabled:opacity-40"
                      onClick={() => setPage(p => Math.min(pages - 1, p + 1))}>下一页 ›</button>
            </span>
          </div>
          <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
            {items.length === 0 && <div className="px-4 py-6 text-sm text-gray-400 text-center">没有匹配的节点。</div>}
            {items.map(it => (
              <button key={it.node_id}
                      className={`w-full text-left px-3 py-2 border-t hover:bg-gray-50 ${selected === it.node_id ? 'bg-primary-soft' : ''}`}
                      onClick={() => setSelected(it.node_id)}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium flex-1 min-w-0 truncate">
                    {it.is_link && <span className="text-blue-600">🔗 </span>}{it.action || '（空步骤）'}
                  </span>
                  {it.expected && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 flex-shrink-0">期望:{it.expected}</span>}
                  {it.reuse_count > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 flex-shrink-0">🔁 {it.reuse_count}</span>}
                </div>
                <div className="text-[11px] text-gray-400 font-mono truncate">{it.path} · {it.suite_name}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: selected node context */}
        <div className="w-96 flex-shrink-0 bg-white border rounded-lg shadow-sm sticky top-4">
          {selected ? (
            <>
              <div className="flex items-center justify-between px-4 py-2 border-b">
                <span className="text-sm font-semibold">节点详情</span>
                <button className="text-xs text-primary" onClick={() => navigate(`/suites/${items.find(i => i.node_id === selected)?.suite_id}`)}>
                  去所在套件编辑 →
                </button>
              </div>
              <NodeContextPanel nodeId={selected} />
            </>
          ) : (
            <div className="p-6 text-sm text-gray-400 text-center">从左侧选一个节点查看它的上级 / 子级 / 引用方。</div>
          )}
        </div>
      </div>
    </div>
  )
}
