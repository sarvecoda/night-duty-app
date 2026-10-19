import { ReactNode } from 'react'
import Navbar from './Navbar'
import { AskWidget } from '../pages/Ask'
import './Layout.css'

interface LayoutProps {
  children: ReactNode
}

function Layout({ children }: LayoutProps) {
  return (
    <div className="layout">
      <Navbar />
      <main className="main-content">
        {children}
      </main>
      <AskWidget />
    </div>
  )
}

export default Layout

