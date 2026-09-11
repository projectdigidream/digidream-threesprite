import { useEffect, useState } from 'react'
import './App.css'
import AppShell from './components/layout/AppShell'
import SmokeTest from './components/dev/SmokeTest'
import { runSelfTest, shouldSelfTest, type SelfTestReport } from './core/selftest'

export default function App() {
  const [selftest, setSelftest] = useState<SelfTestReport | 'running' | null>(null)
  useEffect(() => {
    shouldSelfTest().then(async yes => {
      if (!yes) return
      setSelftest('running')
      setSelftest(await runSelfTest())
    })
  }, [])
  if (selftest) {
    return (
      <pre style={{ padding: 16, whiteSpace: 'pre-wrap', color: '#e8ecf2' }}>
        {selftest === 'running' ? 'Self-test running…' : JSON.stringify(selftest, null, 2)}
      </pre>
    )
  }
  if (typeof window !== 'undefined' && window.location.search.includes('smoke')) return <SmokeTest />
  return <AppShell />
}
