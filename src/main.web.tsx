import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Browser build entry. Identical tree; platform differences are decided at
// runtime by `isTauri()` so there is exactly one app.
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
