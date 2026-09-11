import './App.css'
import AppShell from './components/layout/AppShell'
import SmokeTest from './components/dev/SmokeTest'

export default function App() {
  if (typeof window !== 'undefined' && window.location.search.includes('smoke')) return <SmokeTest />
  return <AppShell />
}
