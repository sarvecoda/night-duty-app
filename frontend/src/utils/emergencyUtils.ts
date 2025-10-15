import { availabilityAPI } from '../services/api'

/**
 * Fetches emergency saint IDs for a given month
 * @param monthYear - The month/year string (e.g., "2024-01")
 * @returns Promise<Set<string>> - Set of emergency saint IDs
 */
export async function getEmergencySaintIds(monthYear: string): Promise<Set<string>> {
  try {
    const availabilityResponse = await availabilityAPI.getByMonth(monthYear)
    return new Set(
      availabilityResponse.data
        .filter(avail => avail.isEmergencyDuty === true)
        .map(avail => avail.saintId)
    )
  } catch (error) {
    console.error('Error fetching emergency status:', error)
    return new Set()
  }
}

/**
 * Gets emergency saints count for warning messages
 * @param monthYear - The month/year string (e.g., "2024-01")
 * @returns Promise<{count: number, warning: string}> - Emergency count and warning message
 */
export async function getEmergencyWarning(monthYear: string): Promise<{count: number, warning: string}> {
  try {
    const availabilityResponse = await availabilityAPI.getByMonth(monthYear)
    const emergencyIds = availabilityResponse.data
      .filter(avail => avail.isEmergencyDuty === true)
      .map(avail => avail.saintId)
    
    const emergencyCount = emergencyIds.length
    let warning = ''
    
    if (emergencyCount === 0) {
      warning = '\n\n⚠️ Warning: No emergency saints selected. It is highly recommended to have 3-4 emergency saints available for backup coverage.'
    } else if (emergencyCount < 3) {
      warning = `\n\n⚠️ Warning: Only ${emergencyCount} emergency saint${emergencyCount !== 1 ? 's' : ''} selected. It is recommended to have at least 3-4 emergency saints for adequate backup coverage.`
    }
    
    return { count: emergencyCount, warning }
  } catch (error) {
    console.error('Error checking emergency saints:', error)
    return { count: 0, warning: '' }
  }
}
