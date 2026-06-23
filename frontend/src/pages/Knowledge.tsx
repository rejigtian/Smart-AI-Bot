import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchKnowledge, addKnowledge, deleteKnowledge, KnowledgeNote } from '../lib/api'
import { useT } from '../lib/i18n'

function Tags({ items, color }: { items: string[]; color: string }) {
  if (!items?.length) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {items.map((x, i) => (
        <span key={i} className={`text-xs px-1.5 py-0.5 rounded ${color}`}>{x}</span>
      ))}
    </div>
  )
}

function NoteCard({ note }: { note: KnowledgeNote }) {
  const t = useT()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const del = useMutation({
    mutationFn: () => deleteKnowledge(note.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge'] }),
  })
  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <button className="text-left flex-1 min-w-0" onClick={() => setOpen(o => !o)}>
          <div className="font-medium text-ink flex items-center gap-1.5">
            <span className="text-ink-faint text-xs">{open ? '▾' : '▸'}</span>
            {note.title}
          </div>
        </button>
        <button
          className="text-xs text-ink-faint hover:text-red-500 shrink-0"
          onClick={() => { if (confirm(t('删除这条知识？', 'Delete this note?'))) del.mutate() }}
        >
          {t('删除', 'Delete')}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="text-sm text-ink-secondary whitespace-pre-wrap">{note.body}</div>
          <Tags items={note.keywords} color="bg-primary-soft text-primary-deep" />
          <Tags items={note.aliases} color="bg-gray-100 text-gray-500" />
          <details className="text-xs text-ink-faint mt-2">
            <summary className="cursor-pointer">{t('原始输入', 'Raw input')}</summary>
            <p className="mt-1 whitespace-pre-wrap">{note.raw_input}</p>
          </details>
          <p className="text-xs text-ink-faint">{new Date(note.created_at).toLocaleString()}</p>
        </div>
      )}
    </div>
  )
}

export default function Knowledge() {
  const t = useT()
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['knowledge', query],
    queryFn: () => fetchKnowledge(query),
  })

  const addMut = useMutation({
    mutationFn: () => addKnowledge(text.trim()),
    onSuccess: () => {
      setText('')
      qc.invalidateQueries({ queryKey: ['knowledge'] })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(e)
      alert(`${t('记录失败', 'Failed to save')}: ${msg}`)
    },
  })

  const canSubmit = text.trim().length > 0 && !addMut.isPending

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-1">{t('知识库', 'Knowledge')}</h1>
      <p className="text-sm text-ink-faint mb-6">
        {t(
          '用大白话说一条关于被测 App 的知识（黑话、功能、入口、坑点都行），AI 会整理后记录下来，方便日后查询。',
          'Describe a fact about the app under test in plain words (slang, a feature, a path, a pitfall). The AI tidies it up and files it so you can look it up later.',
        )}
      </p>

      <div className="bg-white border rounded-lg p-4 shadow-sm space-y-3">
        <textarea
          rows={3}
          className="w-full border rounded px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder={t('例如：本App里"金币"和"钻石"是两种不同货币', 'e.g. In this app, "coins" and "gems" are two different currencies')}
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <div className="flex justify-end">
          <button
            className="bg-primary text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-primary-deep disabled:opacity-50"
            disabled={!canSubmit}
            onClick={() => addMut.mutate()}
          >
            {addMut.isPending ? t('整理中…', 'Organizing…') : t('记录', 'Save')}
          </button>
        </div>
      </div>

      <div className="mt-6">
        <input
          className="w-full border rounded px-3 py-1.5 text-sm mb-3"
          placeholder={t('搜索知识库…', 'Search the knowledge base…')}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {isLoading ? (
          <p className="text-sm text-gray-500">{t('加载中…', 'Loading…')}</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            {query ? t('没有匹配的知识。', 'No matching notes.') : t('还没有知识，先在上面记一条吧。', 'No notes yet — jot one down above.')}
          </p>
        ) : (
          <div className="space-y-3">
            {notes.map(n => <NoteCard key={n.id} note={n} />)}
          </div>
        )}
      </div>
    </div>
  )
}
