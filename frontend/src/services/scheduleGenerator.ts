import { Saint, Availability, MonthlySchedule, ScheduleAssignment, ScheduleWarning } from '../types'

interface GenerateScheduleParams {
  saints: Saint[]
  availabilities: Map<string, Availability>
  monthYear: string
}

// Fisher-Yates shuffle algorithm for proper unbiased randomization
function fisherYatesShuffle<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

// Calculate week number within a month (1-based)
function getWeekNumber(dateString: string): number {
  const date = new Date(dateString + 'T00:00:00')
  const year = date.getFullYear()
  const month = date.getMonth()
  
  // Get first day of month
  const firstDay = new Date(year, month, 1)
  const dayOfMonth = date.getDate()
  const firstDayOfWeek = firstDay.getDay()
  
  // Calculate week number within month (1-based)
  return Math.ceil((dayOfMonth + firstDayOfWeek) / 7)
}

// Generate week key for tracking (YYYY-MM-W#)
function getWeekKey(dateString: string): string {
  const date = new Date(dateString + 'T00:00:00')
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const weekNum = getWeekNumber(dateString)
  return `${year}-${String(month).padStart(2, '0')}-W${weekNum}`
}

// Check if saint can work on specific date considering availability constraints
function canSaintWorkOnDate(
  saint: Saint,
  date: string,
  dayOfWeek: string,
  availability: Availability | undefined,
  currentDutyCount: number,
  saintWeeklyAssignments: Map<string, Set<string>>,
  saintLastAssignedDate: Map<string, string>,
  maxDuties: number = 2
): boolean {
  // Check if saint has reached max duties
  if (currentDutyCount >= maxDuties) return false
  
  // NEW: Check if saint already assigned this week
  const weekKey = getWeekKey(date)
  const assignedWeeks = saintWeeklyAssignments.get(saint.id) || new Set()
  if (assignedWeeks.has(weekKey)) return false
  
  // NEW: Check minimum gap (7 days between duties)
  const lastAssigned = saintLastAssignedDate.get(saint.id)
  if (lastAssigned) {
    const lastDate = new Date(lastAssigned + 'T00:00:00')
    const currentDate = new Date(date + 'T00:00:00')
    const daysDiff = Math.floor((currentDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysDiff < 7) return false // Minimum 7 days gap
  }
  
  // Check availability constraints
  if (availability) {
    // If availableDays specified, ONLY those days are valid
    if (availability.availableDays && availability.availableDays.length > 0) {
      if (!availability.availableDays.includes(dayOfWeek)) return false
    }
    
    // If availableDates specified, ONLY those dates are valid
    if (availability.availableDates && availability.availableDates.length > 0) {
      if (!availability.availableDates.includes(date)) return false
    }
    
    // Check unavailable specific dates
    if (availability.unavailableDates && availability.unavailableDates.includes(date)) return false
    
    // Check unavailable days of week
    if (availability.unavailableDays && availability.unavailableDays.includes(dayOfWeek)) return false
  }
  
  return true
}

// Validate distribution fairness and add warnings
function validateDistribution(
  regularSaints: Saint[],
  saintDutyCount: Map<string, number>,
  warnings: ScheduleWarning[]
): void {
  const saintsWith0Duties = regularSaints.filter(s => (saintDutyCount.get(s.id) || 0) === 0)
  const saintsWith2Duties = regularSaints.filter(s => (saintDutyCount.get(s.id) || 0) === 2)
  
  if (saintsWith0Duties.length > 0 && saintsWith2Duties.length > 5) {
    warnings.push({
      type: 'constraint_conflict',
      message: `Uneven distribution: ${saintsWith0Duties.length} saint(s) have 0 duties while ${saintsWith2Duties.length} have 2 duties. This may indicate overly restrictive availability constraints.`,
      saintIds: saintsWith0Duties.map(s => s.id)
    })
  }
}

// Pre-assign partner preferences to random valid dates
function preAssignPartnerPreferences(
  dates: string[],
  regularSaints: Saint[],
  availabilities: Map<string, Availability>,
  saintDutyCount: Map<string, number>,
  saintWeeklyAssignments: Map<string, Set<string>>,
  saintLastAssignedDate: Map<string, string>
): Map<string, [Saint, Saint]> {
  const preAssignedDates = new Map<string, [Saint, Saint]>()
  const assignedPairs = new Set<string>()
  
  // Collect all general partner preferences
  const preferenceList: Array<{ saint1: Saint; saint2: Saint }> = []
  
  for (const saint1 of regularSaints) {
    const availability1 = availabilities.get(saint1.id)
    if (!availability1 || availability1.partnerPreferences.length === 0) continue
    
    for (const preferredId of availability1.partnerPreferences) {
      const saint2 = regularSaints.find(s => s.id === preferredId)
      if (!saint2) continue
      
      // Create unique pair identifier (sorted to avoid duplicates)
      const pairKey = [saint1.id, saint2.id].sort().join('-')
      
      // Skip if this pair already processed
      if (assignedPairs.has(pairKey)) continue
      
      preferenceList.push({ saint1, saint2 })
      assignedPairs.add(pairKey)
    }
  }
  
  // Shuffle preferences for random order processing
  const shuffledPreferences = fisherYatesShuffle(preferenceList)
  
  // Try to assign each preference pair to MULTIPLE random valid dates (up to 2)
  for (const { saint1, saint2 } of shuffledPreferences) {
    const availability1 = availabilities.get(saint1.id)
    const availability2 = availabilities.get(saint2.id)
    
    // Find all valid dates for this pair
    const validDates = dates.filter(date => {
      // Skip if date already assigned
      if (preAssignedDates.has(date)) return false
      
      const dayOfWeek = getDayOfWeek(date)
      const count1 = saintDutyCount.get(saint1.id) || 0
      const count2 = saintDutyCount.get(saint2.id) || 0
      
      // Both saints must be available
      return canSaintWorkOnDate(saint1, date, dayOfWeek, availability1, count1, saintWeeklyAssignments, saintLastAssignedDate) &&
             canSaintWorkOnDate(saint2, date, dayOfWeek, availability2, count2, saintWeeklyAssignments, saintLastAssignedDate)
    })
    
    // NEW: Assign them to work together on MULTIPLE dates (up to 2)
    // This ensures general partners work together for BOTH their duties
    const datesToAssign = Math.min(2, validDates.length)
    const selectedDates: string[] = []
    
    for (let i = 0; i < datesToAssign; i++) {
      if (validDates.length === 0) break
      
      const randomIndex = Math.floor(Math.random() * validDates.length)
      const selectedDate = validDates.splice(randomIndex, 1)[0]
      selectedDates.push(selectedDate)
      
      preAssignedDates.set(selectedDate, [saint1, saint2])
      
      // Update duty counts
      saintDutyCount.set(saint1.id, (saintDutyCount.get(saint1.id) || 0) + 1)
      saintDutyCount.set(saint2.id, (saintDutyCount.get(saint2.id) || 0) + 1)
      
      // Update weekly tracking
      const weekKey = getWeekKey(selectedDate)
      const weeks1 = saintWeeklyAssignments.get(saint1.id) || new Set()
      const weeks2 = saintWeeklyAssignments.get(saint2.id) || new Set()
      weeks1.add(weekKey)
      weeks2.add(weekKey)
      saintWeeklyAssignments.set(saint1.id, weeks1)
      saintWeeklyAssignments.set(saint2.id, weeks2)
      
      // Update last assigned date tracking
      saintLastAssignedDate.set(saint1.id, selectedDate)
      saintLastAssignedDate.set(saint2.id, selectedDate)
    }
  }
  
  return preAssignedDates
}

export function generateMonthlySchedule(params: GenerateScheduleParams): MonthlySchedule {
  const { saints, availabilities, monthYear } = params
  
  // Filter out emergency saints AND completely unavailable saints
  // Check emergency status from availability data for this month, not global saint property
  const regularSaints = saints.filter(s => {
    const availability = availabilities.get(s.id)
    const isEmergencyThisMonth = availability?.isEmergencyDuty === true
    return !isEmergencyThisMonth && !s.isUnavailableForDuty
  })
  
  // Get all dates in the month
  const [year, month] = monthYear.split('-').map(Number)
  const dates = getAllDatesInMonth(year, month)
  
  const assignments: ScheduleAssignment[] = []
  const warnings: ScheduleWarning[] = []
  const saintDutyCount = new Map<string, number>()
  const saintWeeklyAssignments = new Map<string, Set<string>>()
  const saintLastAssignedDate = new Map<string, string>()
  
  // Initialize duty counts
  regularSaints.forEach(s => saintDutyCount.set(s.id, 0))
  
  // PHASE 1: Pre-assign partner preferences to random dates
  const preAssignedDates = preAssignPartnerPreferences(dates, regularSaints, availabilities, saintDutyCount, saintWeeklyAssignments, saintLastAssignedDate)
  
  // PHASE 2: Shuffle dates for random processing order
  const shuffledDates = fisherYatesShuffle(dates)
  
  // PHASE 3: Process each date with improved randomization
  for (const date of shuffledDates) {
    const dayOfWeek = getDayOfWeek(date)
    let selectedSaints: Saint[] = []
    
    // Check for date-specific partner preferences first (highest priority)
    const dateSpecificPairs = findDateSpecificPartners(regularSaints, availabilities, date, saintDutyCount, saintWeeklyAssignments, saintLastAssignedDate)
    
    if (dateSpecificPairs.length > 0) {
      // Use date-specific preference (shuffle if multiple)
      const shuffledPairs = fisherYatesShuffle(dateSpecificPairs)
      const [saint1, saint2] = shuffledPairs[0]
      selectedSaints = [saint1, saint2]
      
      // Check if preference is one-sided
      const reciprocal = checkReciprocalPreference(saint1.id, saint2.id, availabilities, date)
      if (!reciprocal) {
        warnings.push({
          type: 'one_sided_preference',
          message: `One-sided partner preference: ${saint1.name} wants to work with ${saint2.name} on ${date}`,
          date,
          saintIds: [saint1.id, saint2.id]
        })
      }
    } else if (preAssignedDates.has(date)) {
      // Use pre-assigned general partner preference
      const [saint1, saint2] = preAssignedDates.get(date)!
      selectedSaints = [saint1, saint2]
      
      // Check if preference is one-sided
      const reciprocal = checkReciprocalGeneralPreference(saint1.id, saint2.id, availabilities)
      if (!reciprocal) {
        warnings.push({
          type: 'one_sided_preference',
          message: `One-sided partner preference: ${saint1.name} wants to work with ${saint2.name}`,
          date,
          saintIds: [saint1.id, saint2.id]
        })
      }
    } else {
      // No preferences - randomly select from available saints
      const availableSaints = regularSaints.filter(saint => {
        const availability = availabilities.get(saint.id)
        const currentDutyCount = saintDutyCount.get(saint.id) || 0
        return canSaintWorkOnDate(saint, date, dayOfWeek, availability, currentDutyCount, saintWeeklyAssignments, saintLastAssignedDate)
      })
      
      // Add warning if constraints are too restrictive
      if (availableSaints.length < 2) {
        warnings.push({
          type: 'insufficient_staff',
          message: `Limited availability for ${date}: Only ${availableSaints.length} saint(s) available after applying all constraints`,
          date,
          saintIds: availableSaints.map(s => s.id)
        })
      }
      
      // Use Fisher-Yates shuffle for proper randomization
      const shuffledSaints = fisherYatesShuffle(availableSaints)
      selectedSaints = shuffledSaints.slice(0, Math.min(2, shuffledSaints.length))
    }
    
    // Create assignment
    if (selectedSaints.length === 2) {
      assignments.push({
        date,
        saintIds: selectedSaints.map(s => s.id),
        saintNames: selectedSaints.map(s => s.name),
        status: 'filled',
        manuallyEdited: false
      })
      
      // Increment duty counts and update tracking (only if not already incremented by pre-assignment)
      if (!preAssignedDates.has(date)) {
        selectedSaints.forEach(s => {
          saintDutyCount.set(s.id, (saintDutyCount.get(s.id) || 0) + 1)
          
          // Update weekly tracking
          const weekKey = getWeekKey(date)
          const weeks = saintWeeklyAssignments.get(s.id) || new Set()
          weeks.add(weekKey)
          saintWeeklyAssignments.set(s.id, weeks)
          
          // Update last assigned date tracking
          saintLastAssignedDate.set(s.id, date)
        })
      }
    } else if (selectedSaints.length === 1) {
      assignments.push({
        date,
        saintIds: [selectedSaints[0].id],
        saintNames: [selectedSaints[0].name],
        status: 'partial',
        manuallyEdited: false
      })
      
      saintDutyCount.set(selectedSaints[0].id, (saintDutyCount.get(selectedSaints[0].id) || 0) + 1)
      
      // Update weekly tracking
      const weekKey = getWeekKey(date)
      const weeks = saintWeeklyAssignments.get(selectedSaints[0].id) || new Set()
      weeks.add(weekKey)
      saintWeeklyAssignments.set(selectedSaints[0].id, weeks)
      
      // Update last assigned date tracking
      saintLastAssignedDate.set(selectedSaints[0].id, date)
      
      warnings.push({
        type: 'insufficient_staff',
        message: `Only 1 saint available for ${date}`,
        date,
        saintIds: selectedSaints.map(s => s.id)
      })
    } else {
      assignments.push({
        date,
        saintIds: [],
        saintNames: [],
        status: 'unfilled',
        manuallyEdited: false
      })
      
      warnings.push({
        type: 'insufficient_staff',
        message: `No staff available for ${date}`,
        date,
        saintIds: []
      })
    }
  }
  
  // PHASE 4: Sort assignments by date for clean display
  assignments.sort((a, b) => a.date.localeCompare(b.date))
  
  // PHASE 5: Validate distribution fairness
  validateDistribution(regularSaints, saintDutyCount, warnings)
  
  return {
    id: monthYear,
    monthYear,
    generatedAt: new Date().toISOString(),
    assignments,
    warnings
  }
}

function getAllDatesInMonth(year: number, month: number): string[] {
  const dates: string[] = []
  const daysInMonth = new Date(year, month, 0).getDate()
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    dates.push(date)
  }
  
  return dates
}

function getDayOfWeek(dateString: string): string {
  const date = new Date(dateString + 'T00:00:00')
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return days[date.getDay()]
}

function findDateSpecificPartners(
  regularSaints: Saint[],
  availabilities: Map<string, Availability>,
  date: string,
  saintDutyCount: Map<string, number>,
  saintWeeklyAssignments: Map<string, Set<string>>,
  saintLastAssignedDate: Map<string, string>
): [Saint, Saint][] {
  const pairs: [Saint, Saint][] = []
  const dayOfWeek = getDayOfWeek(date)
  
  for (const saint1 of regularSaints) {
    const availability1 = availabilities.get(saint1.id)
    if (!availability1) continue
    
    // Check if saint1 can work on this date
    const count1 = saintDutyCount.get(saint1.id) || 0
    if (!canSaintWorkOnDate(saint1, date, dayOfWeek, availability1, count1, saintWeeklyAssignments, saintLastAssignedDate)) continue
    
    for (const pref of availability1.dateSpecificPartners) {
      if (pref.date === date) {
        const saint2 = regularSaints.find(s => s.id === pref.partnerId)
        if (!saint2) continue
        
        // Check if saint2 can work on this date
        const availability2 = availabilities.get(saint2.id)
        const count2 = saintDutyCount.get(saint2.id) || 0
        if (canSaintWorkOnDate(saint2, date, dayOfWeek, availability2, count2, saintWeeklyAssignments, saintLastAssignedDate)) {
          pairs.push([saint1, saint2])
        }
      }
    }
  }
  
  return pairs
}

function checkReciprocalPreference(
  saint1Id: string,
  saint2Id: string,
  availabilities: Map<string, Availability>,
  date: string
): boolean {
  const availability2 = availabilities.get(saint2Id)
  if (!availability2) return false
  
  return availability2.dateSpecificPartners.some(
    pref => pref.date === date && pref.partnerId === saint1Id
  )
}

function checkReciprocalGeneralPreference(
  saint1Id: string,
  saint2Id: string,
  availabilities: Map<string, Availability>
): boolean {
  const availability2 = availabilities.get(saint2Id)
  if (!availability2) return false
  
  return availability2.partnerPreferences.includes(saint1Id)
}

