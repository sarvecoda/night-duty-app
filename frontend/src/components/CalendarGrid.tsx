import { ScheduleAssignment } from '../types'
import './CalendarGrid.css'

interface CalendarGridProps {
  monthYear: string
  assignments: ScheduleAssignment[]
  onEditAssignment?: (date: string) => void
}

function CalendarGrid({ monthYear, assignments, onEditAssignment }: CalendarGridProps) {
  const [year, month] = monthYear.split('-').map(Number)
  
  // Get first day of month and number of days
  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  
  // Create calendar grid
  const weeks: (number | null)[][] = []
  let currentWeek: (number | null)[] = Array(firstDay).fill(null)
  
  for (let day = 1; day <= daysInMonth; day++) {
    currentWeek.push(day)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null)
    }
    weeks.push(currentWeek)
  }
  
  const getAssignmentForDate = (day: number): ScheduleAssignment | undefined => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return assignments.find(a => a.date === dateStr)
  }
  
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  
  return (
    <div className="calendar-grid">
      <div className="calendar-header">
        {dayNames.map(day => (
          <div key={day} className="calendar-day-name">
            {day}
          </div>
        ))}
      </div>
      <div className="calendar-body">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="calendar-week">
            {week.map((day, dayIndex) => {
              if (day === null) {
                return <div key={`empty-${dayIndex}`} className="calendar-cell empty" />
              }
              
              const assignment = getAssignmentForDate(day)
              const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              
              return (
                <div key={day} className="calendar-cell">
                  <div className="cell-header">
                    <span className="cell-date">{day}</span>
                    {assignment && onEditAssignment && (
                      <button
                        className="cell-edit-btn"
                        onClick={() => onEditAssignment(dateStr)}
                        title="Edit assignment"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                      </button>
                    )}
                  </div>
                  {assignment ? (
                    <div className="cell-content">
                      {assignment.saintNames.length > 0 ? (
                        <div className="staff-list">
                          {assignment.saintNames.map((name, index) => (
                            <div key={index} className="staff-item">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                              </svg>
                              <span>{name}</span>
                            </div>
                          ))}
                          {assignment.manuallyEdited && (
                            <span className="manual-badge" title="Manually edited">✎</span>
                          )}
                        </div>
                      ) : (
                        <span className={`badge badge-${assignment.status === 'unfilled' ? 'danger' : 'warning'}`}>
                          {assignment.status === 'unfilled' ? 'Unfilled' : 'Needs 1 more'}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="cell-content empty-content">
                      <span className="text-muted">No assignment</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export default CalendarGrid

