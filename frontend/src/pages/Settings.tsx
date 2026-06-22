import { useEffect, useState, ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchSettings, saveSettings, Settings as SettingsData,
  fetchProjects, createProject, updateProject, deleteProject, Project,
} from '../lib/api'

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  bedrock: ['us.anthropic.claude-sonnet-4-6', 'us.anthropic.claude-opus-4-8', 'us.anthropic.claude-haiku-4-5-20251001-v1:0'],
  google: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  zhipuai: ['glm-4v', 'glm-4v-plus', 'glm-4-plus', 'glm-4-flash'],
  groq: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
  ollama: ['llama3', 'llama3.1', 'qwen2', 'mistral'],
}

const PROVIDERS = Object.keys(PROVIDER_MODELS)

type FieldDef = { key: keyof SettingsData; label: string; placeholder?: string; type?: string }

// Credential fields each provider needs. A provider with no entry needs no key.
const PROVIDER_FIELDS: Record<string, FieldDef[]> = {
  openai: [{ key: 'openai_api_key', label: 'API Key', placeholder: 'sk-…', type: 'password' }],
  anthropic: [
    { key: 'anthropic_api_key', label: 'API Key', placeholder: 'sk-ant-…', type: 'password' },
    { key: 'anthropic_base_url', label: 'Base URL (LiteLLM proxy, optional)', placeholder: 'https://litellm.example.com' },
  ],
  bedrock: [
    { key: 'aws_access_key_id', label: 'AWS Access Key ID', placeholder: 'AKIA…' },
    { key: 'aws_secret_access_key', label: 'AWS Secret Access Key', type: 'password' },
    { key: 'aws_region_name', label: 'AWS Region', placeholder: 'us-east-2' },
  ],
  google: [{ key: 'gemini_api_key', label: 'API Key', type: 'password' }],
  zhipuai: [{ key: 'zhipu_api_key', label: 'API Key', type: 'password' }],
  groq: [{ key: 'groq_api_key', label: 'API Key', type: 'password' }],
  ollama: [{ key: 'ollama_base_url', label: 'Base URL', placeholder: 'http://localhost:11434' }],
}

function isConfigured(form: Partial<SettingsData>, provider: string): boolean {
  const fields = PROVIDER_FIELDS[provider] || []
  // ollama only needs a base URL which has a default → always "ready"
  if (provider === 'ollama') return true
  return fields.some(f => !!(form[f.key] as string)?.trim())
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState<Project>(project)
  const saveMut = useMutation({
    mutationFn: () => updateProject(project.id, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
  const field = (label: string, key: keyof Project, ph: string) => (
    <div>
      <label className="text-xs text-gray-500">{label}</label>
      <input
        className="w-full border rounded px-2 py-1 text-sm font-mono"
        placeholder={ph}
        value={form[key]}
        onChange={e => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  )
  return (
    <div className="border rounded-lg p-4 bg-white space-y-2">
      {field('名称 / Name', 'name', '项目名')}
      {field('应用包名 / app_package（匹配键）', 'app_package', 'com.example.app')}
      {field('知识检索命令 / kb_search_cmd（优先，留空则用下方关键词检索）', 'kb_search_cmd', '项目自带的检索 CLI，如 `<cmd> "<query>" -n N`')}
      {field('知识库路径 / kb_path（绝对路径，支持 ~/；无检索命令时的关键词兜底）', 'kb_path', '/Users/you/repo/knowledge 或 ~/repo/knowledge')}
      {field('Skills 路径（暂未启用）', 'skills_path', '~/repo/skills')}
      {field('源码路径 / source_root（卡点时 agent 可搜/读源码）', 'source_root', '~/repo/android-src')}
      <div className="flex gap-2 pt-1">
        <button
          className="px-3 py-1 bg-primary text-white text-xs rounded hover:bg-primary-deep disabled:opacity-50"
          disabled={saveMut.isPending}
          onClick={() => saveMut.mutate()}
        >
          {saveMut.isPending ? '保存中…' : '保存'}
        </button>
        <button
          className="px-3 py-1 border border-red-200 text-red-600 text-xs rounded hover:bg-red-50"
          onClick={() => { if (confirm('删除这个项目档案？')) onDelete() }}
        >
          删除
        </button>
      </div>
    </div>
  )
}

function ProjectProfiles() {
  const qc = useQueryClient()
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects })
  const createMut = useMutation({
    mutationFn: () => createProject({ name: '新项目' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold">项目档案（可选）</h2>
        <button
          className="text-sm text-primary hover:text-primary-deep"
          onClick={() => createMut.mutate()}
        >
          + 添加项目
        </button>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        为某个 App 导入它自带的知识库 / skill / 源码路径，帮助 AI 更好地测试；不配置也照常运行。
        与本地测试知识库相互独立。按「应用包名」匹配——在套件页给套件设置同样的包名即可生效。
      </p>
      {projects.length === 0 && <p className="text-sm text-gray-400">还没有项目档案。</p>}
      <div className="space-y-3">
        {projects.map(p => <ProjectCard key={p.id} project={p} onDelete={() => delMut.mutate(p.id)} />)}
      </div>
    </div>
  )
}

export default function Settings() {
  const { data: remote, isLoading } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings })
  const [form, setForm] = useState<Partial<SettingsData>>({})
  const [saved, setSaved] = useState(false)
  const [showOthers, setShowOthers] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => { if (remote) setForm(remote) }, [remote])

  const saveMut = useMutation({
    mutationFn: () => saveSettings(form as SettingsData),
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000) },
  })

  if (isLoading) return <p className="text-gray-500">Loading…</p>

  const provider = form.default_provider || 'openai'
  const set = (k: keyof SettingsData, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  const Field = ({ f }: { f: FieldDef }) => (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
      <input
        type={f.type || 'text'}
        className="w-full border rounded px-3 py-1.5 text-sm font-mono"
        placeholder={f.placeholder || ''}
        value={(form[f.key] as string) || ''}
        onChange={e => set(f.key, e.target.value)}
      />
    </div>
  )

  const Collapsible = ({ title, open, onToggle, children }:
    { title: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) => (
    <div className="border-t pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-sm font-medium text-gray-700 hover:text-gray-900"
      >
        <span>{title}</span>
        <span className="text-gray-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  )

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="bg-white border rounded-lg p-6 shadow-sm space-y-5">

        {/* ── Agent Model + selected provider's credentials ── */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Agent 模型</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Provider</label>
              <select
                className="w-full border rounded px-3 py-1.5 text-sm"
                value={provider}
                onChange={e => {
                  const p = e.target.value
                  setForm(prev => ({ ...prev, default_provider: p, default_model: (PROVIDER_MODELS[p] || [])[0] || '' }))
                }}
              >
                {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Model</label>
              <input
                type="text"
                className="w-full border rounded px-3 py-1.5 text-sm font-mono"
                placeholder={PROVIDER_MODELS[provider]?.[0] || ''}
                value={form.default_model || ''}
                onChange={e => set('default_model', e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-gray-400">
            可直接输入自定义 model 名，如 us.anthropic.claude-sonnet-4-6
          </p>

          {/* credentials for the currently-selected provider, inline */}
          {(PROVIDER_FIELDS[provider] || []).length > 0 && (
            <div className="bg-gray-50 border rounded p-3 space-y-3">
              <p className="text-xs font-medium text-gray-600">{provider} 凭证</p>
              {(PROVIDER_FIELDS[provider] || []).map(f => <Field key={f.key as string} f={f} />)}
            </div>
          )}
        </div>

        {/* ── Other providers (for fallback / switching) ── */}
        <Collapsible
          title={<>其它 Provider 凭证 <span className="text-xs font-normal text-gray-400">（用于切换 / fallback）</span></>}
          open={showOthers}
          onToggle={() => setShowOthers(v => !v)}
        >
          {PROVIDERS.filter(p => p !== provider).map(p => (
            <div key={p} className="border rounded p-3 space-y-3">
              <p className="text-xs font-medium text-gray-600 flex items-center gap-2">
                {p}
                {isConfigured(form, p)
                  ? <span className="text-ok">✓ 已配置</span>
                  : <span className="text-gray-400">○ 未配置</span>}
              </p>
              {(PROVIDER_FIELDS[p] || []).map(f => <Field key={f.key as string} f={f} />)}
            </div>
          ))}
        </Collapsible>

        {/* ── Advanced: Verifier + Webhook ── */}
        <Collapsible
          title={<>高级：Verifier / Webhook</>}
          open={showAdvanced}
          onToggle={() => setShowAdvanced(v => !v)}
        >
          <div>
            <p className="text-sm font-medium mb-1">Verification Model <span className="text-xs font-normal text-gray-400">(optional)</span></p>
            <p className="text-xs text-gray-400 mb-2">
              用于 pass/fail 判断的专用模型。留空则与 Agent 使用同一模型。
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Provider</label>
                <select
                  className="w-full border rounded px-3 py-1.5 text-sm"
                  value={form.verifier_provider || ''}
                  onChange={e => set('verifier_provider', e.target.value)}
                >
                  <option value="">— 与 Agent 相同 —</option>
                  {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <input
                  type="text"
                  className="w-full border rounded px-3 py-1.5 text-sm font-mono"
                  placeholder="留空 = 同 Agent"
                  value={form.verifier_model || ''}
                  onChange={e => set('verifier_model', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="pt-1">
            <p className="text-sm font-medium mb-1">Webhook Notification <span className="text-xs font-normal text-gray-400">(optional)</span></p>
            <p className="text-xs text-gray-400 mb-2">Run 完成后推送结果到飞书/钉钉/Slack。</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Type</label>
                <select
                  className="w-full border rounded px-3 py-1.5 text-sm"
                  value={form.webhook_type || ''}
                  onChange={e => set('webhook_type', e.target.value)}
                >
                  <option value="">-- disabled --</option>
                  <option value="feishu">Feishu / Lark</option>
                  <option value="dingtalk">DingTalk</option>
                  <option value="slack">Slack</option>
                  <option value="custom">Custom POST</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Webhook URL</label>
                <input
                  type="text"
                  className="w-full border rounded px-3 py-1.5 text-sm font-mono"
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  value={form.webhook_url || ''}
                  onChange={e => set('webhook_url', e.target.value)}
                />
              </div>
            </div>
          </div>
        </Collapsible>

        <button
          className="w-full bg-primary text-white py-2 rounded font-medium hover:bg-primary-deep disabled:opacity-50"
          disabled={saveMut.isPending}
          onClick={() => saveMut.mutate()}
        >
          {saved ? '✓ Saved' : saveMut.isPending ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      <ProjectProfiles />
    </div>
  )
}
