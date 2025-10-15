import { useState, useEffect } from 'react'
import { MonthlySchedule } from '../types'
import { scheduleAPI, availabilityAPI } from '../services/api'
import { useAppContext } from '../contexts/AppContext'
import { Link } from 'react-router-dom'
import { getSaintInitials } from '../utils/nameUtils'
import './Dashboard.css'

function Dashboard() {
  const { saints, loading: saintsLoading, selectedMonthYear: monthYear } = useAppContext()
  const [stats, setStats] = useState({
    totalSaints: 0,
    regularSaints: 0,
    emergencySaints: 0,
    currentMonthScheduled: 0,
    currentMonthUnfilled: 0
  })
  const [currentSchedule, setCurrentSchedule] = useState<MonthlySchedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [emergencySaintIds, setEmergencySaintIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!saintsLoading) {
      fetchDashboardData()
    }
  }, [saintsLoading, monthYear])

  const fetchDashboardData = async () => {
    setLoading(true)
    try {
      // Fetch availability data for selected month to get emergency status
      const availabilityResponse = await availabilityAPI.getByMonth(monthYear)
      const emergencyIds = new Set(
        availabilityResponse.data
          .filter(avail => avail.isEmergencyDuty === true)
          .map(avail => avail.saintId)
      )
      setEmergencySaintIds(emergencyIds)
      
      const emergency = saints.filter(s => emergencyIds.has(s.id))
      const regular = saints.filter(s => !emergencyIds.has(s.id) && !s.isUnavailableForDuty)

      // Fetch schedule for selected month
      let schedule: MonthlySchedule | null = null
      try {
        const scheduleResponse = await scheduleAPI.getByMonth(monthYear)
        schedule = scheduleResponse.data
        setCurrentSchedule(schedule)
      } catch (error: any) {
        if (error.response?.status !== 404) {
          console.error('Error fetching schedule:', error)
        }
      }

      // Calculate stats
      const scheduled = schedule?.assignments.filter(a => a.status === 'filled').length || 0
      const unfilled = schedule?.assignments.filter(a => a.status !== 'filled').length || 0

      setStats({
        totalSaints: saints.length,
        regularSaints: regular.length,
        emergencySaints: emergency.length,
        currentMonthScheduled: scheduled,
        currentMonthUnfilled: unfilled
      })
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const emergencySaintsList = saints.filter(s => emergencySaintIds.has(s.id))

  const upcomingAssignments = currentSchedule?.assignments
    .filter(a => {
      const assignmentDate = new Date(a.date + 'T00:00:00')
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      return assignmentDate >= today && a.status === 'filled'
    })
    .slice(0, 5) || []

  const unfilledAssignments = currentSchedule?.assignments
    .filter(a => a.status !== 'filled')
    .slice(0, 5) || []

  if (saintsLoading && saints.length === 0) {
    return (
      <div className="container">
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          Loading dashboard...
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <p className="dashboard-subtitle">Welcome! Here's your night duty overview.</p>
      </div>

      {loading ? (
        <div className="loading-state">Loading...</div>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(79, 70, 229, 0.1)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </div>
              <div className="stat-content">
                <p className="stat-label">Total Saints</p>
                <p className="stat-value">{stats.totalSaints}</p>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="8.5" cy="7" r="4"></circle>
                </svg>
              </div>
              <div className="stat-content">
                <p className="stat-label">Regular Saints</p>
                <p className="stat-value">{stats.regularSaints}</p>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
              </div>
              <div className="stat-content">
                <p className="stat-label">Emergency Saints</p>
                <p className="stat-value">{stats.emergencySaints}</p>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(6, 182, 212, 0.1)', color: 'var(--secondary-color)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
              </div>
              <div className="stat-content">
                <p className="stat-label">This Month Scheduled</p>
                <p className="stat-value">{stats.currentMonthScheduled}</p>
              </div>
            </div>
          </div>

          {stats.currentMonthUnfilled > 0 && (
            <div className="alert-card warning">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <div>
                <h3>Attention Required</h3>
                <p>{stats.currentMonthUnfilled} days need manual assignment for this month</p>
              </div>
              <Link to="/schedule" className="btn btn-secondary">View Schedule</Link>
            </div>
          )}

          {emergencySaintsList.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2>Emergency Duty Saints</h2>
                <span className="badge badge-warning">{emergencySaintsList.length} Available</span>
              </div>
              <div className="emergency-saints-grid">
                {emergencySaintsList.map(member => (
                  <div key={member.id} className="emergency-saints-item">
                    <div className="saint-avatar-mini">
                      {getSaintInitials(member.name)}
                    </div>
                    <div>
                      <p className="saint-name">{member.name}</p>
                      {member.description && <p className="saint-desc-mini">{member.description}</p>}
                      <p className="saint-contact-mini">{member.mobile}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentSchedule ? (
            <>
              {upcomingAssignments.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <h2>Upcoming Duties</h2>
                    <Link to="/schedule" className="btn btn-secondary">View All</Link>
                  </div>
                  <div className="duties-list">
                    {upcomingAssignments.map(assignment => (
                      <div key={assignment.date} className="duty-item">
                        <div className="duty-date">
                          <span className="date-day">
                            {new Date(assignment.date + 'T00:00:00').getDate()}
                          </span>
                          <span className="date-month">
                            {new Date(assignment.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}
                          </span>
                        </div>
                        <div className="duty-info">
                          <p className="duty-saints">{assignment.saintNames.join(' & ')}</p>
                          <p className="duty-day">
                            {new Date(assignment.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}
                          </p>
                        </div>
                        <span className="badge badge-success">Scheduled</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {unfilledAssignments.length > 0 && (
                <div className="card">
                  <div className="card-header">
                    <h2>Needs Attention</h2>
                    <Link to="/schedule" className="btn btn-secondary">Fix Now</Link>
                  </div>
                  <div className="duties-list">
                    {unfilledAssignments.map(assignment => (
                      <div key={assignment.date} className="duty-item warning-item">
                        <div className="duty-date">
                          <span className="date-day">
                            {new Date(assignment.date + 'T00:00:00').getDate()}
                          </span>
                          <span className="date-month">
                            {new Date(assignment.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}
                          </span>
                        </div>
                        <div className="duty-info">
                          <p className="duty-saints">
                            {assignment.saintNames.length > 0 ? assignment.saintNames.join(' & ') : 'No assignment'}
                          </p>
                          <p className="duty-day">
                            {new Date(assignment.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}
                          </p>
                        </div>
                        <span className={`badge badge-${assignment.status === 'unfilled' ? 'danger' : 'warning'}`}>
                          {assignment.status === 'unfilled' ? 'Unfilled' : 'Needs 1 more'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="card empty-schedule-notice">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <h3>No Schedule for This Month</h3>
              <p>Generate a schedule to start managing night duty assignments</p>
              <Link to="/schedule" className="btn btn-primary">Go to Schedule</Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default Dashboard
