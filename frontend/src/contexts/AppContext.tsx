import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { Saint } from '../types'
import { saintsAPI } from '../services/api'

interface AppContextType {
  saints: Saint[]
  loading: boolean
  refreshSaints: () => Promise<void>
  selectedMonthYear: string
  setSelectedMonthYear: (month: string) => void
}

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  const [saints, setSaints] = useState<Saint[]>([])
  const [loading, setLoading] = useState(true)
  
  // Initialize with current month
  const [selectedMonthYear, setSelectedMonthYear] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const refreshSaints = async () => {
    setLoading(true)
    try {
      const response = await saintsAPI.getAll()
      setSaints(response.data)
    } catch (error) {
      console.error('Error fetching saints:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshSaints()
  }, [])

  return (
    <AppContext.Provider value={{ saints, loading, refreshSaints, selectedMonthYear, setSelectedMonthYear }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext() {
  const context = useContext(AppContext)
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider')
  }
  return context
}

