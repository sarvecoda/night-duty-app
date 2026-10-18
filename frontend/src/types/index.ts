export interface Saint {
  id: string
  name: string
  mobile: string
  email?: string
  description?: string
  isEmergencyDuty: boolean
  isUnavailableForDuty: boolean
  isAdmin?: boolean
  createdAt: string
}

// Keep for backward compatibility during transition
export type StaffMember = Saint

export interface Availability {
  id: string
  saintId: string
  monthYear: string
  unavailableDates: string[]
  unavailableDays: string[]
  availableDates: string[]
  availableDays: string[]
  partnerPreferences: string[]
  dateSpecificPartners: { date: string; partnerId: string }[]
  isEmergencyDuty?: boolean
}

export interface ScheduleAssignment {
  date: string
  saintIds: string[]
  saintNames: string[]
  status: 'filled' | 'unfilled' | 'partial'
  manuallyEdited: boolean
}

export interface MonthlySchedule {
  id: string
  monthYear: string
  generatedAt: string
  assignments: ScheduleAssignment[]
  warnings: ScheduleWarning[]
}

export interface ScheduleWarning {
  type: 'one_sided_preference' | 'insufficient_staff' | 'constraint_conflict'
  message: string
  date?: string
  saintIds?: string[]
}

