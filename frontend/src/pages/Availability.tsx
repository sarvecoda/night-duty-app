import { useState, useEffect } from 'react'
import { Availability as AvailabilityType, Saint } from '../types'
import { availabilityAPI } from '../services/api'
import { useAppContext } from '../contexts/AppContext'
import { useToast } from '../contexts/ToastContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { getSaintInitials } from '../utils/nameUtils'
import './Availability.css'

function Availability() {
  const { saints: allSaints, loading: saintsLoading, refreshSaints, selectedMonthYear: monthYear } = useAppContext()
  const { showToast } = useToast()
  const [availabilities, setAvailabilities] = useState<Map<string, AvailabilityType>>(new Map())
  const [expandedSaint, setExpandedSaint] = useState<string | null>(null)
  const [_loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    title: string
    message: string
    type: 'warning' | 'danger' | 'info'
    onConfirm: () => void
  } | null>(null)

  const saints = allSaints // Show ALL saints, not just regular ones

  useEffect(() => {
    if (!saintsLoading) {
      fetchData()
    }
  }, [monthYear, saintsLoading])

  const fetchData = async () => {
    setLoading(true)
    try {

      // Fetch availabilities for the month
      const availResponse = await availabilityAPI.getByMonth(monthYear)
      const availMap = new Map<string, AvailabilityType>()
      availResponse.data.forEach(avail => {
        availMap.set(avail.saintId, avail)
      })
      setAvailabilities(availMap)
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaintClick = (saintId: string) => {
    setExpandedSaint(expandedSaint === saintId ? null : saintId)
  }

  // Emergency toggle is now handled locally in SaintAvailabilityCard
  // No immediate backend save - only when "Save Availability" is clicked

  const cleanupOldAvailabilityData = async (currentMonthYear: string) => {
    try {
      const [year, month] = currentMonthYear.split('-').map(Number)
      
      // Calculate cutoff date (3 months ago = current month - 3)
      const cutoffDate = new Date(year, month - 1 - 2, 1) // -2 for previous 2 months
      const cutoffMonthYear = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`
      
      // Get all availability records
      const allAvail = await availabilityAPI.getAll()
      
      // Delete records older than cutoff
      const deletePromises = allAvail.data
        .filter(avail => avail.monthYear < cutoffMonthYear)
        .map(avail => availabilityAPI.delete(avail.id))
      
      if (deletePromises.length > 0) {
        await Promise.all(deletePromises)
        console.log(`Cleaned up ${deletePromises.length} old availability records`)
      }
    } catch (error) {
      console.error('Error cleaning up old data:', error)
    }
  }

  // Cleanup old data and collapse cards when month changes
  useEffect(() => {
    setExpandedSaint(null) // Collapse all cards when month changes
    cleanupOldAvailabilityData(monthYear)
  }, [monthYear])

  const getAvailabilityForSaint = (saintId: string): AvailabilityType => {
    return availabilities.get(saintId) || {
      id: '',
      saintId,
      monthYear,
      unavailableDates: [],
      unavailableDays: [],
      availableDates: [],
      availableDays: [],
      partnerPreferences: [],
      dateSpecificPartners: []
    }
  }

  const saveAvailability = async (saintId: string, data: Omit<AvailabilityType, 'id'>) => {
    try {
      const existing = availabilities.get(saintId)
      if (existing && existing.id) {
        await availabilityAPI.update(existing.id, data)
      } else {
        await availabilityAPI.create(data)
      }
      await fetchData()
      showToast('Availability saved successfully', 'success')
    } catch (error) {
      console.error('Error saving availability:', error)
      showToast('Failed to save availability', 'error')
    }
  }

  // Filter saints based on search query
  const filteredSaints = saints.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.mobile.includes(searchQuery)
  )

  return (
    <div className="container">
      <div className="availability-header">
        <div>
          <h1>Availability Management</h1>
          <p className="availability-subtitle">
            Set unavailable dates, days, and partner preferences for each saint
          </p>
        </div>
      </div>

      <input
        type="text"
        className="input search-input"
        placeholder="Search saints by name or phone..."
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
      />

      {saintsLoading && saints.length === 0 ? (
        <div className="loading-state">Loading...</div>
      ) : filteredSaints.length === 0 ? (
        <div className="empty-state">
          <p>{searchQuery ? 'No saints found matching your search.' : 'No regular saints found. Please add saints first.'}</p>
        </div>
      ) : (
        <div className="saints-availability-list">
          {filteredSaints.map(member => (
            <SaintAvailabilityCard
              key={member.id}
              saint={member}
              allSaints={saints}
              availability={getAvailabilityForSaint(member.id)}
              monthYear={monthYear}
              isExpanded={expandedSaint === member.id}
              onToggle={() => handleSaintClick(member.id)}
              onSave={(data) => saveAvailability(member.id, data)}
              showToast={showToast}
              refreshSaints={refreshSaints}
              availabilities={availabilities}
            />
          ))}
        </div>
      )}

      {confirmDialog && (
        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          type={confirmDialog.type}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  )
}

interface SaintAvailabilityCardProps {
  saint: Saint
  allSaints: Saint[]
  availability: AvailabilityType
  monthYear: string
  isExpanded: boolean
  onToggle: () => void
  onSave: (data: Omit<AvailabilityType, 'id'>) => void
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
  refreshSaints: () => Promise<void>
  availabilities: Map<string, AvailabilityType>
}

function SaintAvailabilityCard({
  saint,
  allSaints,
  availability,
  monthYear,
  isExpanded,
  onToggle,
  onSave,
  showToast,
  refreshSaints,
  availabilities
}: SaintAvailabilityCardProps) {
  // Helper function to normalize availability data
  const normalizeAvailability = (avail: AvailabilityType): AvailabilityType => {
    return {
      ...avail,
      unavailableDates: avail.unavailableDates || [],
      unavailableDays: avail.unavailableDays || [],
      availableDates: avail.availableDates || [],
      availableDays: avail.availableDays || [],
      partnerPreferences: avail.partnerPreferences || [],
      dateSpecificPartners: avail.dateSpecificPartners || [],
      isEmergencyDuty: avail.isEmergencyDuty || false
    }
  }

  const [formData, setFormData] = useState(normalizeAvailability(availability))
  const [activeTab, setActiveTab] = useState<'unavailability' | 'availability' | 'preferences'>('unavailability')
  const [unavailableDateMode, setUnavailableDateMode] = useState<'individual' | 'range'>('individual')
  const [availableDateMode, setAvailableDateMode] = useState<'individual' | 'range'>('individual')
  const [newDate, setNewDate] = useState('')
  const [dateRange, setDateRange] = useState({ from: '', to: '' })
  const [availableDateRange, setAvailableDateRange] = useState({ from: '', to: '' })
  const [newDatePartner, setNewDatePartner] = useState({ date: '', partnerId: '' })
  const [showPartnerModal, setShowPartnerModal] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    title: string
    message: string
    type: 'warning' | 'danger' | 'info'
    onConfirm: () => void
  } | null>(null)

  useEffect(() => {
    setFormData(normalizeAvailability(availability))
  }, [availability])

  useEffect(() => {
    // Close partner modal when card is collapsed
    if (!isExpanded && showPartnerModal) {
      setShowPartnerModal(false)
    }
  }, [isExpanded, showPartnerModal])

  const daysOfWeek = [
    { value: 'monday', label: 'Monday' },
    { value: 'tuesday', label: 'Tuesday' },
    { value: 'wednesday', label: 'Wednesday' },
    { value: 'thursday', label: 'Thursday' },
    { value: 'friday', label: 'Friday' },
    { value: 'saturday', label: 'Saturday' },
    { value: 'sunday', label: 'Sunday' }
  ]

  // Local handler for emergency toggle - only updates local state
  const handleToggleEmergency = (checked: boolean) => {
    if (checked && hasAnyAvailabilityConditions()) {
      // Clear all conditions when marking as emergency
      setFormData({
        ...formData,
        isEmergencyDuty: true,
        unavailableDates: [],
        unavailableDays: [],
        availableDates: [],
        availableDays: [],
        partnerPreferences: [],
        dateSpecificPartners: []
      })
      showToast('All availability conditions cleared for emergency duty', 'info')
    } else {
      setFormData({ ...formData, isEmergencyDuty: checked })
    }
  }

  // Helper function to check if saint has any availability conditions
  const hasAnyAvailabilityConditions = () => {
    return formData.unavailableDates.length > 0 ||
           formData.unavailableDays.length > 0 ||
           formData.availableDates.length > 0 ||
           formData.availableDays.length > 0 ||
           formData.partnerPreferences.length > 0 ||
           formData.dateSpecificPartners.length > 0
  }

  // Helper function to check and remove emergency status when conditions are added
  const checkAndRemoveEmergency = () => {
    if (formData.isEmergencyDuty) {
      setFormData({ ...formData, isEmergencyDuty: false })
      showToast('Emergency duty removed. To be on emergency duty, saints must be available for the entire month without conditions.', 'warning')
    }
  }

  // Handler to toggle unavailable status - saves immediately as this is global status
  const handleToggleUnavailable = async (saintId: string, isUnavailableNew: boolean) => {
    try {
      const { saintsAPI } = await import('../services/api')
      const updates: Partial<Saint> = { isUnavailableForDuty: isUnavailableNew }
      
      await saintsAPI.update(saintId, updates)
      await refreshSaints()
      
      showToast(
        isUnavailableNew 
          ? 'Saint marked as not available for night duty' 
          : 'Saint marked as available for night duty', 
        'success'
      )
    } catch (error) {
      console.error('Error updating saint availability:', error)
      showToast('Failed to update saint availability', 'error')
    }
  }


  // Helper function to get day of week from date string
  const getDayOfWeek = (dateString: string): string => {
    const date = new Date(dateString + 'T00:00:00')
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    return days[date.getDay()]
  }

  // Helper function to filter dates by day of week
  const filterDatesByDayOfWeek = (dates: string[], dayOfWeek: string): string[] => {
    return dates.filter(date => getDayOfWeek(date) === dayOfWeek)
  }

  const toggleDay = (day: string) => {
    const isAdding = !formData.unavailableDays.includes(day)
    const dayCapitalized = day.charAt(0).toUpperCase() + day.slice(1)
    
    if (isAdding) {
      // Check for conflicts and resolve automatically
      const hasAvailableDay = formData.availableDays.includes(day)
      const conflictingAvailableDates = filterDatesByDayOfWeek(formData.availableDates, day)
      
      if (hasAvailableDay || conflictingAvailableDates.length > 0) {
        let removedItems: string[] = []
        if (hasAvailableDay) removedItems.push(`${dayCapitalized} from Available Days`)
        if (conflictingAvailableDates.length > 0) removedItems.push(`${conflictingAvailableDates.length} available date(s) on ${dayCapitalized}`)
        
        showToast(`Automatically removed: ${removedItems.join(', ')}`, 'info')
      }
      
      checkAndRemoveEmergency()
      const days = [...formData.unavailableDays, day]
      const availableDays = formData.availableDays.filter(d => d !== day)
      const availableDates = formData.availableDates.filter(date => getDayOfWeek(date) !== day)
      setFormData({ ...formData, unavailableDays: days, availableDays, availableDates })
    } else {
      const days = formData.unavailableDays.filter(d => d !== day)
      setFormData({ ...formData, unavailableDays: days })
    }
  }

  const toggleAvailableDay = (day: string) => {
    const isAdding = !formData.availableDays.includes(day)
    const dayCapitalized = day.charAt(0).toUpperCase() + day.slice(1)
    
    if (isAdding) {
      // Check for conflicts and resolve automatically
      const hasUnavailableDay = formData.unavailableDays.includes(day)
      const conflictingUnavailableDates = filterDatesByDayOfWeek(formData.unavailableDates, day)
      
      if (hasUnavailableDay || conflictingUnavailableDates.length > 0) {
        let removedItems: string[] = []
        if (hasUnavailableDay) removedItems.push(`${dayCapitalized} from Unavailable Days`)
        if (conflictingUnavailableDates.length > 0) removedItems.push(`${conflictingUnavailableDates.length} unavailable date(s) on ${dayCapitalized}`)
        
        showToast(`Automatically removed: ${removedItems.join(', ')}`, 'info')
      }
      
      checkAndRemoveEmergency()
      const days = [...formData.availableDays, day]
      const unavailableDays = formData.unavailableDays.filter(d => d !== day)
      const unavailableDates = formData.unavailableDates.filter(date => getDayOfWeek(date) !== day)
      setFormData({ ...formData, availableDays: days, unavailableDays, unavailableDates })
    } else {
      const days = formData.availableDays.filter(d => d !== day)
      setFormData({ ...formData, availableDays: days })
    }
  }

  const addUnavailableDate = () => {
    if (newDate && !formData.unavailableDates.includes(newDate)) {
      const dayOfWeek = getDayOfWeek(newDate)
      const dateFormatted = new Date(newDate + 'T00:00:00').toLocaleDateString()
      const dayCapitalized = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)
      
      // Check for conflicts
      const hasAvailableDate = formData.availableDates.includes(newDate)
      const hasAvailableDay = formData.availableDays.includes(dayOfWeek)
      const hasConflicts = hasAvailableDate || hasAvailableDay
      
      if (hasConflicts) {
        let conflictMessage = `Adding ${dateFormatted} as unavailable will automatically remove:\n`
        if (hasAvailableDate) conflictMessage += `- ${dateFormatted} from Available Dates\n`
        if (hasAvailableDay) conflictMessage += `- ${dayCapitalized} from Available Days\n`
        conflictMessage += '\nDo you want to proceed?'
        
        setConfirmDialog({
          isOpen: true,
          title: 'Automatic Conflict Resolution',
          message: conflictMessage,
          type: 'warning',
          onConfirm: () => {
            checkAndRemoveEmergency()
            const availableDates = formData.availableDates.filter(d => d !== newDate)
            const availableDays = formData.availableDays.filter(d => d !== dayOfWeek)
            setFormData({
              ...formData,
              unavailableDates: [...formData.unavailableDates, newDate].sort(),
              availableDates,
              availableDays
            })
            setNewDate('')
            showToast(`${dateFormatted} marked as unavailable`, 'info')
            setConfirmDialog(null)
          }
        })
      } else {
        checkAndRemoveEmergency()
      setFormData({
        ...formData,
        unavailableDates: [...formData.unavailableDates, newDate].sort()
      })
      setNewDate('')
      }
    }
  }

  const addUnavailableDateRange = () => {
    if (dateRange.from && dateRange.to) {
      const dates = generateDateRange(dateRange.from, dateRange.to)
      const conflictingDates = formData.availableDates.filter(d => dates.includes(d))
      const daysInRange = new Set(dates.map(date => getDayOfWeek(date)))
      const conflictingDays = formData.availableDays.filter(day => daysInRange.has(day))
      const hasConflicts = conflictingDates.length > 0 || conflictingDays.length > 0
      
      if (hasConflicts) {
        let conflictMessage = `Adding date range as unavailable will automatically remove:\n`
        if (conflictingDates.length > 0) conflictMessage += `- ${conflictingDates.length} date(s) from Available Dates\n`
        if (conflictingDays.length > 0) conflictMessage += `- Days: ${conflictingDays.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')} from Available Days\n`
        conflictMessage += '\nDo you want to proceed?'
        
        setConfirmDialog({
          isOpen: true,
          title: 'Automatic Conflict Resolution',
          message: conflictMessage,
          type: 'warning',
          onConfirm: () => {
            checkAndRemoveEmergency()
            const uniqueDates = [...new Set([...formData.unavailableDates, ...dates])].sort()
            const availableDates = formData.availableDates.filter(d => !dates.includes(d))
            const availableDays = formData.availableDays.filter(day => !daysInRange.has(day))
            setFormData({
              ...formData,
              unavailableDates: uniqueDates,
              availableDates,
              availableDays
            })
            setDateRange({ from: '', to: '' })
            showToast(`Date range marked as unavailable`, 'info')
            setConfirmDialog(null)
          }
        })
      } else {
        checkAndRemoveEmergency()
        const uniqueDates = [...new Set([...formData.unavailableDates, ...dates])].sort()
        setFormData({
          ...formData,
          unavailableDates: uniqueDates
        })
        setDateRange({ from: '', to: '' })
      }
    }
  }

  const addAvailableDate = () => {
    if (newDate && !formData.availableDates.includes(newDate)) {
      const dayOfWeek = getDayOfWeek(newDate)
      const dateFormatted = new Date(newDate + 'T00:00:00').toLocaleDateString()
      const dayCapitalized = dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)
      
      // Check for conflicts
      const hasUnavailableDate = formData.unavailableDates.includes(newDate)
      const hasUnavailableDay = formData.unavailableDays.includes(dayOfWeek)
      const hasConflicts = hasUnavailableDate || hasUnavailableDay
      
      if (hasConflicts) {
        let conflictMessage = `Adding ${dateFormatted} as available will automatically remove:\n`
        if (hasUnavailableDate) conflictMessage += `- ${dateFormatted} from Unavailable Dates\n`
        if (hasUnavailableDay) conflictMessage += `- ${dayCapitalized} from Unavailable Days\n`
        conflictMessage += '\nDo you want to proceed?'
        
        setConfirmDialog({
          isOpen: true,
          title: 'Automatic Conflict Resolution',
          message: conflictMessage,
          type: 'warning',
          onConfirm: () => {
            checkAndRemoveEmergency()
            const unavailableDates = formData.unavailableDates.filter(d => d !== newDate)
            const unavailableDays = formData.unavailableDays.filter(d => d !== dayOfWeek)
            setFormData({
              ...formData,
              availableDates: [...formData.availableDates, newDate].sort(),
              unavailableDates,
              unavailableDays
            })
            setNewDate('')
            showToast(`${dateFormatted} marked as available`, 'info')
            setConfirmDialog(null)
          }
        })
      } else {
        checkAndRemoveEmergency()
        setFormData({
          ...formData,
          availableDates: [...formData.availableDates, newDate].sort()
        })
        setNewDate('')
      }
    }
  }

  const addAvailableDateRange = () => {
    if (availableDateRange.from && availableDateRange.to) {
      const dates = generateDateRange(availableDateRange.from, availableDateRange.to)
      const conflictingDates = formData.unavailableDates.filter(d => dates.includes(d))
      const daysInRange = new Set(dates.map(date => getDayOfWeek(date)))
      const conflictingDays = formData.unavailableDays.filter(day => daysInRange.has(day))
      const hasConflicts = conflictingDates.length > 0 || conflictingDays.length > 0
      
      if (hasConflicts) {
        let conflictMessage = `Adding date range as available will automatically remove:\n`
        if (conflictingDates.length > 0) conflictMessage += `- ${conflictingDates.length} date(s) from Unavailable Dates\n`
        if (conflictingDays.length > 0) conflictMessage += `- Days: ${conflictingDays.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')} from Unavailable Days\n`
        conflictMessage += '\nDo you want to proceed?'
        
        setConfirmDialog({
          isOpen: true,
          title: 'Automatic Conflict Resolution',
          message: conflictMessage,
          type: 'warning',
          onConfirm: () => {
            checkAndRemoveEmergency()
            const uniqueDates = [...new Set([...formData.availableDates, ...dates])].sort()
            const unavailableDates = formData.unavailableDates.filter(d => !dates.includes(d))
            const unavailableDays = formData.unavailableDays.filter(day => !daysInRange.has(day))
            setFormData({
              ...formData,
              availableDates: uniqueDates,
              unavailableDates,
              unavailableDays
            })
            setAvailableDateRange({ from: '', to: '' })
            showToast(`Date range marked as available`, 'info')
            setConfirmDialog(null)
          }
        })
      } else {
        checkAndRemoveEmergency()
        const uniqueDates = [...new Set([...formData.availableDates, ...dates])].sort()
        setFormData({
          ...formData,
          availableDates: uniqueDates
        })
        setAvailableDateRange({ from: '', to: '' })
      }
    }
  }

  const generateDateRange = (from: string, to: string): string[] => {
    const dates: string[] = []
    const startDate = new Date(from + 'T00:00:00')
    const endDate = new Date(to + 'T00:00:00')
    
    if (startDate > endDate) {
      showToast('Start date must be before or equal to end date', 'error')
      return []
    }

    const currentDate = new Date(startDate)
    while (currentDate <= endDate) {
      const year = currentDate.getFullYear()
      const month = String(currentDate.getMonth() + 1).padStart(2, '0')
      const day = String(currentDate.getDate()).padStart(2, '0')
      dates.push(`${year}-${month}-${day}`)
      currentDate.setDate(currentDate.getDate() + 1)
    }
    
    return dates
  }

  const removeUnavailableDate = (date: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Remove Unavailable Date?',
      message: `This will remove ${date} from unavailable dates.`,
      type: 'warning',
      onConfirm: () => {
    setFormData({
      ...formData,
      unavailableDates: formData.unavailableDates.filter(d => d !== date)
        })
        setConfirmDialog(null)
      }
    })
  }

  const removeAvailableDate = (date: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Remove Available Date?',
      message: `This will remove ${date} from available dates.`,
      type: 'warning',
      onConfirm: () => {
        setFormData({
          ...formData,
          availableDates: formData.availableDates.filter(d => d !== date)
        })
        setConfirmDialog(null)
      }
    })
  }

  const togglePartnerPreference = (partnerId: string) => {
    const isAdding = !formData.partnerPreferences.includes(partnerId)
    
    if (isAdding) {
      checkAndRemoveEmergency()
      const partners = [...formData.partnerPreferences, partnerId]
    setFormData({ ...formData, partnerPreferences: partners })
    } else {
      // Removing partner - show confirmation
      setConfirmDialog({
        isOpen: true,
        title: 'Remove Partner Preference?',
        message: 'This will remove the selected saint from general partner preferences.',
        type: 'warning',
        onConfirm: () => {
          const partners = formData.partnerPreferences.filter(p => p !== partnerId)
          setFormData({ ...formData, partnerPreferences: partners })
          setConfirmDialog(null)
        }
      })
    }
  }

  const addDateSpecificPartner = () => {
    if (newDatePartner.date && newDatePartner.partnerId) {
      const exists = formData.dateSpecificPartners.some(
        p => p.date === newDatePartner.date && p.partnerId === newDatePartner.partnerId
      )
      if (!exists) {
        checkAndRemoveEmergency()
        setFormData({
          ...formData,
          dateSpecificPartners: [
            ...formData.dateSpecificPartners,
            { date: newDatePartner.date, partnerId: newDatePartner.partnerId }
          ].sort((a, b) => a.date.localeCompare(b.date))
        })
        setNewDatePartner({ date: '', partnerId: '' })
      }
    }
  }

  const removeDateSpecificPartner = (date: string, partnerId: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Remove Date-Specific Partner?',
      message: 'This will remove the selected partner preference for this specific date.',
      type: 'warning',
      onConfirm: () => {
    setFormData({
      ...formData,
      dateSpecificPartners: formData.dateSpecificPartners.filter(
        p => !(p.date === date && p.partnerId === partnerId)
      )
        })
        setConfirmDialog(null)
      }
    })
  }

  const handleSave = async () => {
    try {
      // Build summary of changes
      const changes: string[] = []
      
      const original = normalizeAvailability(availability)
      
      // Check what changed
      if (formData.isEmergencyDuty !== original.isEmergencyDuty) {
        changes.push(formData.isEmergencyDuty ? 'Emergency: Yes' : 'Emergency: No')
      }
      
      if (formData.unavailableDays.length > 0 || original.unavailableDays.length !== formData.unavailableDays.length) {
        changes.push(`${formData.unavailableDays.length} unavailable days`)
      }
      
      if (formData.unavailableDates.length > 0 || original.unavailableDates.length !== formData.unavailableDates.length) {
        changes.push(`${formData.unavailableDates.length} unavailable dates`)
      }
      
      if (formData.availableDays.length > 0 || original.availableDays.length !== formData.availableDays.length) {
        changes.push(`${formData.availableDays.length} available days`)
      }
      
      if (formData.availableDates.length > 0 || original.availableDates.length !== formData.availableDates.length) {
        changes.push(`${formData.availableDates.length} available dates`)
      }
      
      if (formData.partnerPreferences.length > 0 || original.partnerPreferences.length !== formData.partnerPreferences.length) {
        changes.push(`${formData.partnerPreferences.length} partner preferences`)
      }
      
      if (formData.dateSpecificPartners.length > 0 || original.dateSpecificPartners.length !== formData.dateSpecificPartners.length) {
        changes.push(`${formData.dateSpecificPartners.length} date-specific partners`)
      }
      
      // Save to backend
      await onSave({
        saintId: saint.id,
        monthYear,
        unavailableDates: formData.unavailableDates,
        unavailableDays: formData.unavailableDays,
        availableDates: formData.availableDates,
        availableDays: formData.availableDays,
        partnerPreferences: formData.partnerPreferences,
        dateSpecificPartners: formData.dateSpecificPartners,
        isEmergencyDuty: formData.isEmergencyDuty
      })
      
      // Show summary toast
      if (changes.length > 0) {
        showToast(`Saved: ${changes.join(', ')}`, 'success')
      } else {
        showToast('Availability saved', 'success')
      }
    } catch (error) {
      console.error('Error saving availability:', error)
      showToast('Failed to save availability', 'error')
    }
  }

  const hasChanges = JSON.stringify(formData) !== JSON.stringify(normalizeAvailability(availability))
  
  // Check if saint has ANY configuration (for orange color)
  const hasAnyConfiguration = 
    formData.unavailableDates.length > 0 ||
    formData.unavailableDays.length > 0 ||
    formData.availableDates.length > 0 ||
    formData.availableDays.length > 0 ||
    formData.partnerPreferences.length > 0 ||
    formData.dateSpecificPartners.length > 0
  
  // Check if saint is unavailable (for red color)
  const isUnavailable = saint.isUnavailableForDuty
  
  // Check if saint is emergency duty (from formData - per month)
  const isEmergency = formData.isEmergencyDuty || false
  
  const otherSaints = allSaints.filter(s => s.id !== saint.id)

  return (
    <div className={`saint-avail-card ${isExpanded ? 'expanded' : ''} ${isUnavailable ? 'unavailable' : isEmergency ? 'emergency' : hasAnyConfiguration ? 'modified' : ''}`}>
      <div className="card-header-row" onClick={onToggle}>
        <div className="saint-basic-info">
          <div className="saint-avatar-small">
            {getSaintInitials(saint.name)}
          </div>
          <div>
            <h3>{saint.name}</h3>
            {saint.description && <p className="saint-desc">{saint.description}</p>}
          </div>
        </div>
        <div className="expand-icon">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>

      {isExpanded && (
        <div className="card-content">
          {/* Status Controls - Only visible when expanded */}
          <div className="status-controls-section">
            <div className="status-toggle">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.isEmergencyDuty || false}
                  onChange={(e) => {
                    e.stopPropagation()
                    handleToggleEmergency(e.target.checked)
                  }}
                  disabled={saint.isUnavailableForDuty}
                />
                <span>Mark as Emergency Duty</span>
              </label>
              <p className="help-text-small">Emergency saints are available anytime but won't be in regular rotation</p>
            </div>
            
            <div className="status-toggle">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={saint.isUnavailableForDuty}
                  onChange={(e) => {
                    e.stopPropagation()
                    handleToggleUnavailable(saint.id, e.target.checked)
                  }}
                  disabled={formData.isEmergencyDuty || false}
                />
                <span>Mark as Not Available for Night Duty</span>
              </label>
              <p className="help-text-small">Saint will be excluded from all schedule generation</p>
            </div>
          </div>

          {/* Unavailable Notice */}
          {isUnavailable && (
            <div className="unavailable-notice">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              <span>This saint is marked as not available for night duty. All configurations are disabled.</span>
            </div>
          )}
          
          {/* Tab Navigation */}
          <div className="tab-navigation">
            <button
              className={`tab-button ${activeTab === 'unavailability' ? 'active' : ''}`}
              onClick={() => setActiveTab('unavailability')}
              disabled={isUnavailable}
            >
              Unavailability
            </button>
            <button
              className={`tab-button ${activeTab === 'availability' ? 'active' : ''}`}
              onClick={() => setActiveTab('availability')}
              disabled={isUnavailable}
            >
              Availability
            </button>
            <button
              className={`tab-button ${activeTab === 'preferences' ? 'active' : ''}`}
              onClick={() => setActiveTab('preferences')}
              disabled={isUnavailable}
            >
              Partner Preferences
            </button>
          </div>

          {/* Tab Content */}
          <div className="tab-content">
            {activeTab === 'unavailability' && (
              <>
          <div className="avail-section">
            <h4>Unavailable Days of Week</h4>
            <div className="days-grid">
              {daysOfWeek.map(day => (
                <label key={day.value} className="day-checkbox">
                  <input
                    type="checkbox"
                    checked={formData.unavailableDays.includes(day.value)}
                    onChange={() => toggleDay(day.value)}
                          disabled={isUnavailable}
                  />
                  <span>{day.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="avail-section">
            <h4>Unavailable Specific Dates</h4>
                  
                  {/* Sub-tabs for date selection */}
                  <div className="sub-tab-navigation">
                    <button
                      className={`sub-tab-button ${unavailableDateMode === 'individual' ? 'active' : ''}`}
                      onClick={() => setUnavailableDateMode('individual')}
                    >
                      Individual Dates
                    </button>
                    <button
                      className={`sub-tab-button ${unavailableDateMode === 'range' ? 'active' : ''}`}
                      onClick={() => setUnavailableDateMode('range')}
                    >
                      Date Range
                    </button>
                  </div>

                  {unavailableDateMode === 'individual' ? (
            <div className="date-input-group">
              <input
                type="date"
                className="input"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                min={`${monthYear}-01`}
                max={`${monthYear}-31`}
                        disabled={isUnavailable}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={addUnavailableDate}
                        disabled={!newDate || isUnavailable}
              >
                Add Date
              </button>
            </div>
                  ) : (
                    <div className="date-range-input-group">
                      <input
                        type="date"
                        className="input"
                        placeholder="From"
                        value={dateRange.from}
                        onChange={e => setDateRange({ ...dateRange, from: e.target.value })}
                        min={`${monthYear}-01`}
                        max={`${monthYear}-31`}
                        disabled={isUnavailable}
                      />
                      <span className="range-separator">to</span>
                      <input
                        type="date"
                        className="input"
                        placeholder="To"
                        value={dateRange.to}
                        onChange={e => setDateRange({ ...dateRange, to: e.target.value })}
                        min={dateRange.from || `${monthYear}-01`}
                        max={`${monthYear}-31`}
                        disabled={isUnavailable}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={addUnavailableDateRange}
                        disabled={!dateRange.from || !dateRange.to || isUnavailable}
                      >
                        Add Range
                      </button>
                    </div>
                  )}

            {formData.unavailableDates.length > 0 && (
              <div className="dates-list">
                {formData.unavailableDates.map(date => (
                  <div key={date} className="date-chip">
                    <span>{new Date(date + 'T00:00:00').toLocaleDateString()}</span>
                    <button
                      type="button"
                      className="remove-btn"
                      onClick={() => removeUnavailableDate(date)}
                            disabled={isUnavailable}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
              </>
            )}

            {activeTab === 'availability' && (
              <>
                <div className="avail-section">
                  <h4>Available Days of Week</h4>
                  <div className="days-grid">
                    {daysOfWeek.map(day => (
                      <label key={day.value} className="day-checkbox">
                        <input
                          type="checkbox"
                          checked={formData.availableDays.includes(day.value)}
                          onChange={() => toggleAvailableDay(day.value)}
                          disabled={isUnavailable}
                        />
                        <span>{day.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="avail-section">
                  <h4>Available Specific Dates</h4>
                  
                  {/* Sub-tabs for date selection */}
                  <div className="sub-tab-navigation">
                    <button
                      className={`sub-tab-button ${availableDateMode === 'individual' ? 'active' : ''}`}
                      onClick={() => setAvailableDateMode('individual')}
                    >
                      Individual Dates
                    </button>
                    <button
                      className={`sub-tab-button ${availableDateMode === 'range' ? 'active' : ''}`}
                      onClick={() => setAvailableDateMode('range')}
                    >
                      Date Range
                    </button>
                  </div>

                  {availableDateMode === 'individual' ? (
                    <div className="date-input-group">
                      <input
                        type="date"
                        className="input"
                        value={newDate}
                        onChange={e => setNewDate(e.target.value)}
                        min={`${monthYear}-01`}
                        max={`${monthYear}-31`}
                        disabled={isUnavailable}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={addAvailableDate}
                        disabled={!newDate || isUnavailable}
                      >
                        Add Date
                      </button>
                    </div>
                  ) : (
                    <div className="date-range-input-group">
                      <input
                        type="date"
                        className="input"
                        placeholder="From"
                        value={availableDateRange.from}
                        onChange={e => setAvailableDateRange({ ...availableDateRange, from: e.target.value })}
                        min={`${monthYear}-01`}
                        max={`${monthYear}-31`}
                        disabled={isUnavailable}
                      />
                      <span className="range-separator">to</span>
                      <input
                        type="date"
                        className="input"
                        placeholder="To"
                        value={availableDateRange.to}
                        onChange={e => setAvailableDateRange({ ...availableDateRange, to: e.target.value })}
                        min={availableDateRange.from || `${monthYear}-01`}
                        max={`${monthYear}-31`}
                        disabled={isUnavailable}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={addAvailableDateRange}
                        disabled={!availableDateRange.from || !availableDateRange.to || isUnavailable}
                      >
                        Add Range
                      </button>
                    </div>
                  )}

                  {formData.availableDates.length > 0 && (
                    <div className="dates-list">
                      {formData.availableDates.map(date => (
                        <div key={date} className="date-chip available-chip">
                          <span>{new Date(date + 'T00:00:00').toLocaleDateString()}</span>
                          <button
                            type="button"
                            className="remove-btn"
                            onClick={() => removeAvailableDate(date)}
                            disabled={isUnavailable}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === 'preferences' && (
              <>
          <div className="avail-section">
            <h4>General Partner Preferences</h4>
            <p className="help-text">Select saints you prefer to work with (any date)</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowPartnerModal(true)}
                    disabled={isUnavailable}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              Select Partners ({formData.partnerPreferences.length} selected)
            </button>
            {formData.partnerPreferences.length > 0 && (
              <div className="selected-partners-chips">
                {formData.partnerPreferences.map(partnerId => {
                  const partner = otherSaints.find(s => s.id === partnerId)
                  return partner ? (
                    <div key={partnerId} className="partner-chip">
                      <span>{partner.name}</span>
                      <button
                        type="button"
                        className="remove-btn"
                        onClick={() => togglePartnerPreference(partnerId)}
                              disabled={isUnavailable}
                      >
                        ×
                      </button>
                    </div>
                  ) : null
                })}
              </div>
            )}
          </div>

          <div className="avail-section">
            <h4>Date-Specific Partner Preferences</h4>
            <p className="help-text">Specify who you want to work with on specific dates</p>
            <div className="date-partner-input-group">
              <input
                type="date"
                className="input"
                value={newDatePartner.date}
                onChange={e => setNewDatePartner({ ...newDatePartner, date: e.target.value })}
                min={`${monthYear}-01`}
                max={`${monthYear}-31`}
                      disabled={isUnavailable}
              />
              <select
                className="input"
                value={newDatePartner.partnerId}
                onChange={e => setNewDatePartner({ ...newDatePartner, partnerId: e.target.value })}
                      disabled={isUnavailable}
              >
                <option value="">Select Partner</option>
                {otherSaints.map(partner => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={addDateSpecificPartner}
                      disabled={!newDatePartner.date || !newDatePartner.partnerId || isUnavailable}
              >
                Add
              </button>
            </div>
            {formData.dateSpecificPartners.length > 0 && (
              <div className="dates-list">
                {formData.dateSpecificPartners.map((pref, index) => {
                  const partner = allSaints.find(s => s.id === pref.partnerId)
                  return (
                    <div key={index} className="date-chip partner-chip">
                      <span>
                        {new Date(pref.date + 'T00:00:00').toLocaleDateString()} - {partner?.name}
                      </span>
                      <button
                        type="button"
                        className="remove-btn"
                        onClick={() => removeDateSpecificPartner(pref.date, pref.partnerId)}
                              disabled={isUnavailable}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="card-actions">
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!hasChanges || isUnavailable}
            >
              Save Availability
            </button>
          </div>

          {/* Partner Preferences Summary - Always visible when card is expanded */}
          {(formData.partnerPreferences.length > 0 || formData.dateSpecificPartners.length > 0) && (
            <div className="partner-summary-section">
              <h4 className="partner-summary-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                Partner Preferences Summary
              </h4>
              
              {/* General Partners */}
              {formData.partnerPreferences.length > 0 && (
                <div className="partner-summary-group">
                  <strong className="summary-label">General Partners:</strong>
                  <div className="partner-avatars-list">
                    {formData.partnerPreferences.map(partnerId => {
                      const partner = otherSaints.find(s => s.id === partnerId)
                      return partner ? (
                        <div key={partnerId} className="partner-avatar-item">
                          <div className="saint-avatar-small">
                            {getSaintInitials(partner.name)}
                          </div>
                          <span className="partner-name-small">{partner.name}</span>
                        </div>
                      ) : null
                    })}
                  </div>
                </div>
              )}
              
              {/* Date-Specific Partners */}
              {formData.dateSpecificPartners.length > 0 && (
                <div className="partner-summary-group">
                  <strong className="summary-label">Date-Specific Partners:</strong>
                  <ul className="date-specific-list">
                    {formData.dateSpecificPartners
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((pref, idx) => {
                        const partner = otherSaints.find(s => s.id === pref.partnerId)
                        const formattedDate = new Date(pref.date + 'T00:00:00').toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })
                        return partner ? (
                          <li key={idx} className="date-specific-item">
                            <span className="date-badge">{formattedDate}</span>
                            <span className="with-text">with</span>
                            <div className="partner-avatar-item">
                              <div className="saint-avatar-mini">
                                {getSaintInitials(partner.name)}
                              </div>
                              <span className="partner-name-small">{partner.name}</span>
                            </div>
                          </li>
                        ) : null
                      })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showPartnerModal && (
        <PartnerSelectionModal
          saints={otherSaints}
          selectedIds={formData.partnerPreferences}
          onToggle={togglePartnerPreference}
          onClose={() => setShowPartnerModal(false)}
          title="Select Partner Preferences"
          showToast={showToast}
          availabilities={availabilities}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          type={confirmDialog.type}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  )
}

interface PartnerSelectionModalProps {
  saints: Saint[]
  selectedIds: string[]
  onToggle: (id: string) => void
  onClose: () => void
  title: string
  showToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void
  availabilities: Map<string, AvailabilityType>
}

function PartnerSelectionModal({ saints, selectedIds, onToggle, onClose, title, showToast, availabilities }: PartnerSelectionModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  
  const filteredSaints = saints.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.mobile.includes(searchQuery)
  )

  const handleTogglePartner = async (saintId: string, saint: Saint) => {
    // Check if the partner saint is on emergency duty for this month
    const partnerAvailability = availabilities.get(saintId)
    const isPartnerEmergency = partnerAvailability?.isEmergencyDuty || false
    
    // If trying to select (not unselect) and the saint is on emergency duty for this month
    if (!selectedIds.includes(saintId) && isPartnerEmergency) {
      showToast(`${saint.name} is on emergency duty. They will be removed from emergency duty when you save availability.`, 'info')
    }
    
    // Always allow the toggle - emergency removal will be handled when saving
    onToggle(saintId)
  }
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal partner-selection-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="btn-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <input
            type="text"
            className="input modal-search-input"
            placeholder="Search saints by name or phone..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            autoFocus
          />
          <div className="partners-selection-list">
            {filteredSaints.length > 0 ? (
              filteredSaints.map(saint => (
                <label key={saint.id} className="partner-selection-item">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(saint.id)}
                    onChange={() => handleTogglePartner(saint.id, saint)}
                  />
                  <div className="partner-info">
                    <div className="partner-name-row">
                      <span className="partner-name">{saint.name}</span>
                      {(() => {
                        const partnerAvailability = availabilities.get(saint.id)
                        return partnerAvailability?.isEmergencyDuty && (
                          <span className="badge badge-warning">Emergency</span>
                        )
                      })()}
                    </div>
                    <span className="partner-mobile">{saint.mobile}</span>
                  </div>
                </label>
              ))
            ) : (
              <p className="empty-text">No saints found matching "{searchQuery}"</p>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done ({selectedIds.length} selected)
          </button>
        </div>
      </div>
    </div>
  )
}

export default Availability

