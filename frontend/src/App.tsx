import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import Devices from './pages/Devices'
import Suites from './pages/Suites'
import SuiteDetail from './pages/SuiteDetail'
import Runs from './pages/Runs'
import RunDetail from './pages/RunDetail'
import Settings from './pages/Settings'
import QuickRun from './pages/QuickRun'
import Recorder from './pages/Recorder'
import RunCompare from './pages/RunCompare'

const NAV_LINKS = [
  { to: '/', label: '设备', end: true },
  { to: '/quick', label: '快速任务', end: false },
  { to: '/recorder', label: '录制', end: false },
  { to: '/suites', label: '测试套件', end: false },
  { to: '/runs', label: '运行记录', end: true },
  { to: '/runs/compare', label: '对比', end: false },
  { to: '/settings', label: '设置', end: false },
]

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-canvas-soft text-ink">
        <nav className="bg-canvas border-b border-hairline">
          <div className="max-w-6xl mx-auto flex items-center gap-6 px-6 h-14">
            <span className="flex items-center gap-2 mr-2">
              <img src="/favicon.png" alt="" className="w-6 h-6 rounded-md" />
              <span className="font-mono font-semibold text-base tracking-tight text-ink">smart-ai-bot</span>
            </span>
            {NAV_LINKS.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `text-sm font-medium transition-colors h-14 flex items-center border-b-2 -mb-px ${
                    isActive
                      ? 'text-primary border-primary'
                      : 'text-ink-mute border-transparent hover:text-ink'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </div>
        </nav>

        <main className="max-w-6xl mx-auto px-6 py-8">
          <Routes>
            <Route path="/" element={<Devices />} />
            <Route path="/quick" element={<QuickRun />} />
            <Route path="/recorder" element={<Recorder />} />
            <Route path="/suites" element={<Suites />} />
            <Route path="/suites/:suiteId" element={<SuiteDetail />} />
            <Route path="/runs" element={<Runs />} />
            <Route path="/runs/compare" element={<RunCompare />} />
            <Route path="/runs/:runId" element={<RunDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
