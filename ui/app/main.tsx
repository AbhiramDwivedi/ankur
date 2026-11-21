import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { pageWorkspaces } from './store/workspaces.ts'
import './styles/app.css'

const root = document.getElementById('root')
if (root === null) throw new Error('index.html has no #root')
pageWorkspaces().startList()
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
