import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  fetchSuites, searchNodes, fetchNodeUsageCounts, fetchNodeUsage, NodeSearchHit, NodeUsageRef,
} from '../lib/api'
import StepTreeEditor from '../components/StepTreeEditor'

// "Where used" popover for a reusable node.
function UsagePanel({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const navigate = useNavigate()
  const { data: refs = [], isLoading } = useQuery({
    queryKey: ['node-usage', nodeId],
    queryFn: () => fetchNodeUsage(nodeId),
  })
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[560px] max-h-[70vh] overflow-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">在哪些用例里被复用</h3>
          <button className="text-ink-faint hover:text-ink" onClick={onClose}>✕</button>
        </div>
        {isLoading && <p className="text-sm text-gray-400">加载中…</p>}
        {!isLoading && refs.length === 0 && <p className="text-sm text-gray-400">还没有被复用。</p>}
        {refs.map((r: NodeUsageRef) => (
          <button
            key={r.node_id}
            className="w-full text-left px-3 py-2 rounded hover:bg-gray-50 border-t text-sm"
            onClick={() => navigate(`/suites/${r.suite_id}`)}
          >
            <span className={`text-[10px] px-1.5 py-0.5 rounded mr-2 ${r.kind === 'link' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
              {r.kind === 'link' ? '活链接' : '快照拷贝'}
            </span>
            <span className="font-mono text-xs">{r.path}</span>
            <span className="text-gray-400"> · {r.suite_name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Library() {
  const navigate = useNavigate()
  const { data: suites = [] } = useQuery({ queryKey: ['suites'], queryFn: fetchSuites })
  const { data: usage = {} } = useQuery({ queryKey: ['node-usage-counts'], queryFn: fetchNodeUsageCounts })
  const [q, setQ] = useState('')
  const [usageNode, setUsageNode] = useState<string | null>(null)
  const { data: hits = [] } = useQuery({
    queryKey: ['node-search', q],
    queryFn: () => (q.trim() ? searchNodes(q.trim()) : Promise.resolve([] as NodeSearchHit[])),
    enabled: q.trim().length > 0,
  })

  // Suites with the most-reused flows float to the top.
  const orderedSuites = useMemo(() => {
    return [...suites].sort((a, b) => a.name.localeCompare(b.name))
  }, [suites])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">用例库</h1>
      <p className="text-sm text-gray-500 mb-4">
        全库可复用流程 · 编辑这里的流程会同步到所有「活链接」引用方 · 🔁 = 被复用次数
      </p>

      <input
        className="w-full max-w-xl border rounded px-3 py-2 text-sm mb-2"
        placeholder="搜索全库流程（行为或期望），如「登录」「语音」"
        value={q}
        onChange={e => setQ(e.target.value)}
      />
      {q.trim() && (
        <div className="bg-white border rounded-lg shadow-sm mb-6 max-w-xl overflow-hidden">
          {hits.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">没有匹配</div>}
          {hits.map(h => (
            <button key={h.node_id} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-t"
                    onClick={() => navigate(`/suites/${h.suite_id}`)}>
              <span className="font-mono text-xs">{h.path}</span>
              {h.expected && <span className="text-blue-600"> · 期望:{h.expected}</span>}
              <span className="text-gray-400"> · {h.suite_name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-6">
        {orderedSuites.map(s => (
          <div key={s.id}>
            <div className="flex items-baseline gap-2 mb-2">
              <h2 className="font-semibold">{(s.name || '').replace(/\.xmind$/i, '')}</h2>
              <button className="text-xs text-primary hover:text-primary-deep" onClick={() => navigate(`/suites/${s.id}`)}>
                打开 →
              </button>
            </div>
            <StepTreeEditor suiteId={s.id} usage={usage} onShowUsage={setUsageNode} />
          </div>
        ))}
        {suites.length === 0 && <p className="text-sm text-gray-400">还没有套件。先在「测试套件」里导入或新建。</p>}
      </div>

      {usageNode && <UsagePanel nodeId={usageNode} onClose={() => setUsageNode(null)} />}
    </div>
  )
}
