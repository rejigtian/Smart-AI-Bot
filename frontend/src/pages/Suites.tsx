import { useRef, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchSuites, uploadSuite, deleteSuite, setSuiteTag, importSuite, type Suite } from '../lib/api'

const PAGE_SIZE = 20

function TagEdit({ suite }: { suite: Suite }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(suite.tag || '')

  const tagMut = useMutation({
    mutationFn: (tag: string) => setSuiteTag(suite.id, tag),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suites'] }),
  })

  if (!editing) {
    return (
      <button
        onClick={() => { setValue(suite.tag || ''); setEditing(true) }}
        className={`text-xs px-2 py-0.5 rounded-full border ${
          suite.tag
            ? 'bg-primary-soft text-primary-deep border-transparent'
            : 'border-dashed border-gray-300 text-gray-400 hover:text-gray-600'
        }`}
      >
        {suite.tag || '+ 标签'}
      </button>
    )
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={() => { setEditing(false); if (value !== (suite.tag || '')) tagMut.mutate(value) }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setValue(suite.tag || ''); setEditing(false) }
      }}
      placeholder="标签名，回车保存"
      className="text-xs px-2 py-0.5 rounded-full border border-primary bg-white focus:outline-none w-28"
    />
  )
}

export default function Suites() {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [tag, setTag] = useState('')
  const [page, setPage] = useState(1)

  // Debounce the search input
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(q); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [q])

  const { data, isLoading } = useQuery({
    queryKey: ['suites', debouncedQ, tag, page],
    queryFn: () => fetchSuites({ q: debouncedQ, tag, page, page_size: PAGE_SIZE }),
  })

  const suites = data?.items ?? []
  const tags = data?.tags ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const uploadMut = useMutation({
    mutationFn: uploadSuite,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suites'] }),
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(e)
      alert(`Upload failed: ${msg}`)
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteSuite,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suites'] }),
  })

  const handleFile = (file: File) => uploadMut.mutate(file)

  const importJsonRef = useRef<HTMLInputElement>(null)
  const importMut = useMutation({
    mutationFn: importSuite,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suites'] }),
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(e)
      alert(`导入失败：${msg}`)
    },
  })
  const handleImportFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text())
      importMut.mutate(data)
    } catch (e) {
      alert(`解析 JSON 失败：${e}`)
    }
  }

  const selectTag = (t: string) => { setTag(t); setPage(1) }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Test Suites</h1>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".xmind,.md,.markdown"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
          />
          <input
            ref={importJsonRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleImportFile(e.target.files[0]) }}
          />
          <button
            className="border border-gray-300 text-gray-700 px-4 py-1.5 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={() => importJsonRef.current?.click()}
            disabled={importMut.isPending}
          >
            {importMut.isPending ? '导入中…' : '导入 JSON'}
          </button>
          <button
            className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-primary-deep disabled:opacity-50"
            onClick={() => fileRef.current?.click()}
            disabled={uploadMut.isPending}
          >
            {uploadMut.isPending ? 'Uploading…' : '+ Upload .xmind / .md'}
          </button>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="搜索套件名称…"
        className="w-full border rounded px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary"
      />

      {/* Tag grouping chips */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={() => selectTag('')}
          className={`text-xs px-3 py-1 rounded-full border ${tag === '' ? 'bg-primary text-white border-transparent' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
        >
          全部 ({total})
        </button>
        {tags.map(t => (
          <button
            key={t}
            onClick={() => selectTag(t)}
            className={`text-xs px-3 py-1 rounded-full border ${tag === t ? 'bg-primary text-white border-transparent' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-gray-500">Loading…</p>}

      {suites.length === 0 && !isLoading && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No test suites found.</p>
          <p className="text-sm mt-1">Upload an XMind / Markdown file, or adjust the search / tag filter.</p>
        </div>
      )}

      <div className="grid gap-3">
        {suites.map(s => (
          <div key={s.id} className="bg-white border rounded-lg p-4 flex items-center gap-4 shadow-sm">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  to={`/suites/${s.id}`}
                  className="font-medium text-primary hover:underline truncate block"
                >
                  {s.name}
                </Link>
                <TagEdit suite={s} />
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {s.source_format} · {s.case_count} cases · {new Date(s.created_at).toLocaleString()}
              </div>
            </div>
            <Link
              to={`/suites/${s.id}`}
              className="text-sm px-3 py-1.5 bg-primary text-white rounded hover:bg-primary-deep"
            >
              Run
            </Link>
            <a
              href={`/api/suites/${s.id}/export`}
              download
              className="text-sm px-3 py-1.5 border border-gray-300 text-gray-700 rounded hover:bg-gray-50"
            >
              导出
            </a>
            <button
              className="text-sm px-3 py-1.5 border border-red-200 text-red-600 rounded hover:bg-red-50"
              onClick={() => {
                if (confirm(`Delete suite "${s.name}"?`)) deleteMut.mutate(s.id)
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            className="px-3 py-1 text-sm border rounded disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            ‹
          </button>
          <span className="text-sm text-gray-500">{page} / {totalPages}</span>
          <button
            className="px-3 py-1 text-sm border rounded disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  )
}
