import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import { useT } from './lib/i18n'
import Devices from './pages/Devices'
import Suites from './pages/Suites'
import SuiteDetail from './pages/SuiteDetail'
import Runs from './pages/Runs'
import RunDetail from './pages/RunDetail'
import Settings from './pages/Settings'
import QuickRun from './pages/QuickRun'
import Recorder from './pages/Recorder'
import RunCompare from './pages/RunCompare'
import Library from './pages/Library'
import Knowledge from './pages/Knowledge'

const NAV_LINKS = [
  { to: '/', label: { zh: '设备', en: 'Device' }, icon: '📱', end: true },
  { to: '/quick', label: { zh: '快速任务', en: 'Quick Task' }, icon: '⚡', end: false },
  { to: '/recorder', label: { zh: '录制', en: 'Record' }, icon: '⏺', end: false },
  { to: '/suites', label: { zh: '测试套件', en: 'Suites' }, icon: '🧪', end: false },
  { to: '/library', label: { zh: '用例库', en: 'Library' }, icon: '📚', end: false },
  { to: '/knowledge', label: { zh: '知识库', en: 'Knowledge' }, icon: '🧠', end: false },
  { to: '/runs', label: { zh: '运行记录', en: 'Run history' }, icon: '▶', end: true },
  { to: '/runs/compare', label: { zh: '对比', en: 'Compare' }, icon: '⇄', end: false },
  { to: '/settings', label: { zh: '设置', en: 'Settings' }, icon: '⚙', end: false },
]

export default function App() {
  const t = useT()
  return (
    <BrowserRouter>
      <div className="min-h-screen flex bg-canvas-soft text-ink">
        {/* Left sidebar */}
        <aside className="w-52 shrink-0 border-r border-hairline bg-canvas flex flex-col sticky top-0 h-screen">
          <div className="h-14 flex items-center gap-2 px-4 border-b border-hairline">
            <img src="/favicon.png" alt="" className="w-6 h-6 rounded-md" />
            <span className="font-mono font-semibold text-base tracking-tight text-ink">smart-ai-bot</span>
          </div>
          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            {NAV_LINKS.map(({ to, label, icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary-soft text-primary-deep'
                      : 'text-ink-mute hover:bg-canvas-cool hover:text-ink'
                  }`
                }
              >
                <span className="w-4 text-center text-xs">{icon}</span>
                {t(label.zh, label.en)}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Main content — full width (wide-screen) */}
        <main className="flex-1 min-w-0 px-8 py-8">
          <div className="max-w-[1700px] mx-auto">
            <Routes>
              <Route path="/" element={<Devices />} />
              <Route path="/quick" element={<QuickRun />} />
              <Route path="/recorder" element={<Recorder />} />
              <Route path="/suites" element={<Suites />} />
              <Route path="/suites/:suiteId" element={<SuiteDetail />} />
              <Route path="/library" element={<Library />} />
              <Route path="/knowledge" element={<Knowledge />} />
              <Route path="/runs" element={<Runs />} />
              <Route path="/runs/compare" element={<RunCompare />} />
              <Route path="/runs/:runId" element={<RunDetail />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </main>
      </div>
    </BrowserRouter>
  )
}
