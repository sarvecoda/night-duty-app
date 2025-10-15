import { useState, useEffect } from 'react'
import { MonthlySchedule, Saint } from '../types'
import { scheduleAPI } from '../services/api'
import { useAppContext } from '../contexts/AppContext'
import { getEmergencySaintIds } from '../utils/emergencyUtils'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import html2canvas from 'html2canvas'
import './Reports.css'

interface SaintDutyCount {
  saintId: string
  saintName: string
  saintMobile: string
  dutyCount: number
}

interface CalendarReportProps {
  monthYear: string
  schedule: MonthlySchedule
  saints: Saint[]
  orgDetails: {
    name: string
    address1: string
    address2: string
    standBySewadars: string
  }
}

function CalendarReport({ monthYear, schedule, saints, orgDetails }: CalendarReportProps) {
  // Parse month and year
  const [year, month] = monthYear.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  
  // Get days in month
  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDay = new Date(year, month - 1, 1).getDay()
  
  // Build calendar grid
  const weeks: Array<Array<{ day: number | null, assignments: any[] }>> = []
  let currentWeek: Array<{ day: number | null, assignments: any[] }> = []
  
  // Fill first week with empty cells
  for (let i = 0; i < firstDay; i++) {
    currentWeek.push({ day: null, assignments: [] })
  }
  
  // Fill with days
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const dayAssignments = schedule.assignments.filter(a => a.date === dateStr && a.status === 'filled')
    
    currentWeek.push({ day, assignments: dayAssignments })
    
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }
  
  // Fill last week
  while (currentWeek.length > 0 && currentWeek.length < 7) {
    currentWeek.push({ day: null, assignments: [] })
  }
  if (currentWeek.length > 0) {
    weeks.push(currentWeek)
  }
  
  return (
    <div className="calendar-report">
      <div className="calendar-report-header">
        <h1>Night Sewa Duty Roster – {monthName}</h1>
        <p className="location-text">At</p>
        <p className="location-address">
          {orgDetails.name}, {orgDetails.address1},
        </p>
        <p className="location-address">{orgDetails.address2}.</p>
      </div>
      
      <table className="calendar-report-table">
        <thead>
          <tr>
            <th>Monday</th>
            <th>Tuesday</th>
            <th>Wednesday</th>
            <th>Thursday</th>
            <th>Friday</th>
            <th>Saturday</th>
            <th>Sunday</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIdx) => (
            <tr key={weekIdx} className={weekIdx % 2 === 0 ? 'even-week' : 'odd-week'}>
              {week.map((cell, dayIdx) => (
                <td key={dayIdx}>
                  {cell.day && (
                    <>
                      <div className="date-header">
                        {cell.day}-{month}-{year}
                      </div>
                      <div className="assignments">
                        {cell.assignments.map((assignment, idx) => {
                          return assignment.saintIds.map((saintId: string, saintIdx: number) => {
                            const saint = saints.find(s => s.id === saintId)
                            if (!saint) return null
                            return (
                              <div key={`${idx}-${saintIdx}`} className="assignment-item">
                                <div className="saint-name">{saint.name}</div>
                                <div className="saint-phone">({saint.mobile})</div>
                              </div>
                            )
                          })
                        })}
                      </div>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      
      <div className="calendar-report-footer">
        <p>Stand by Sewadars: {orgDetails.standBySewadars}</p>
      </div>
    </div>
  )
}

function Reports() {
  const { saints: allSaints, loading: saintsLoading, selectedMonthYear: monthYear, setSelectedMonthYear } = useAppContext()
  const [stats, setStats] = useState<SaintDutyCount[]>([])
  const [schedule, setSchedule] = useState<MonthlySchedule | null>(null)
  const [loading, setLoading] = useState(false)
  const [emergencySaintIds, setEmergencySaintIds] = useState<Set<string>>(new Set())
  const [reportFormat, setReportFormat] = useState<'table' | 'calendar'>('calendar')
  const [orgDetails] = useState({
    name: 'Sant Nirankari Satsang Bhawan No 88',
    address1: 'Ratna Vilas Road, Southend Circle',
    address2: 'Basavanagudi, Bengaluru 560004',
    standBySewadars: 'Rev. Vijay Ji, Rev. Darmendar Ji'
  })

  const saints = allSaints.filter(s => !emergencySaintIds.has(s.id))

  useEffect(() => {
    const fetchEmergencyStatus = async () => {
      try {
        const emergencyIds = await getEmergencySaintIds(monthYear)
        setEmergencySaintIds(emergencyIds)
      } catch (error) {
        console.error('Error fetching emergency status:', error)
      }
    }
    
    if (!saintsLoading) {
      fetchEmergencyStatus()
      fetchReportData()
    }
  }, [monthYear, saintsLoading])

  const fetchReportData = async () => {
    setLoading(true)
    try {
      try {
        const scheduleResponse = await scheduleAPI.getByMonth(monthYear)
        const scheduleData = scheduleResponse.data
        setSchedule(scheduleData)

        // Calculate duty counts per saint
        const dutyCounts = new Map<string, number>()
        scheduleData.assignments.forEach(assignment => {
          assignment.saintIds.forEach(saintId => {
            dutyCounts.set(saintId, (dutyCounts.get(saintId) || 0) + 1)
          })
        })

        const saintStats: SaintDutyCount[] = saints.map(saint => ({
          saintId: saint.id,
          saintName: saint.name,
          saintMobile: saint.mobile,
          dutyCount: dutyCounts.get(saint.id) || 0
        }))

        setStats(saintStats.sort((a, b) => b.dutyCount - a.dutyCount))
      } catch (error: any) {
        if (error.response?.status !== 404) {
          console.error('Error fetching schedule:', error)
        }
        setSchedule(null)
        setStats([])
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const totalDuties = schedule?.assignments.filter(a => a.status === 'filled').length || 0
  const totalUnfilled = schedule?.assignments.filter(a => a.status !== 'filled').length || 0
  const totalDays = schedule?.assignments.length || 0

  const exportToCSV = () => {
    if (!schedule) return

    const monthName = new Date(monthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    
    // Create CSV content
    let csv = `Night Duty Schedule - ${monthName}\n\n`
    csv += `Summary:\n`
    csv += `Total Days,${totalDays}\n`
    csv += `Filled Days,${totalDuties}\n`
    csv += `Unfilled Days,${totalUnfilled}\n`
    csv += `Fill Rate,${totalDays > 0 ? Math.round((totalDuties / totalDays) * 100) : 0}%\n\n`
    
    csv += `Schedule:\n`
    csv += `Date,Day,Saints Assigned,Status\n`
    schedule.assignments.forEach(assignment => {
      const date = new Date(assignment.date)
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' })
      csv += `${assignment.date},${dayName},"${assignment.saintNames.join(', ')}",${assignment.status}\n`
    })

    csv += `\nDuty Distribution:\n`
    csv += `Saint Name,Phone Number,Duties Assigned,Max Duties,Percentage\n`
    stats.forEach(stat => {
      const percentage = Math.round((stat.dutyCount / 2) * 100)
      csv += `${stat.saintName},${stat.saintMobile},${stat.dutyCount},2,${percentage}%\n`
    })

    // Download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `night-duty-report-${monthYear}.csv`
    link.click()
  }

  const exportToExcel = () => {
    if (!schedule) return

    const monthName = new Date(monthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

    // Summary sheet
    const summaryData = [
      ['Night Duty Schedule Report'],
      ['Month', monthName],
      [''],
      ['Summary'],
      ['Total Days', totalDays],
      ['Filled Days', totalDuties],
      ['Unfilled Days', totalUnfilled],
      ['Fill Rate', `${totalDays > 0 ? Math.round((totalDuties / totalDays) * 100) : 0}%`]
    ]

    // Schedule sheet
    const scheduleData = [
      ['Date', 'Day', 'Saints Assigned', 'Status']
    ]
    schedule.assignments.forEach(assignment => {
      const date = new Date(assignment.date)
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' })
      scheduleData.push([
        assignment.date,
        dayName,
        assignment.saintNames.join(', '),
        assignment.status
      ])
    })

    // Distribution sheet
    const distributionData = [
      ['Saint Name', 'Phone Number', 'Duties Assigned', 'Max Duties', 'Percentage']
    ]
    stats.forEach(stat => {
      const percentage = `${Math.round((stat.dutyCount / 2) * 100)}%`
      distributionData.push([
        stat.saintName,
        stat.saintMobile,
        stat.dutyCount.toString(),
        '2',
        percentage
      ])
    })

    // Create workbook
    const wb = XLSX.utils.book_new()
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
    const wsSchedule = XLSX.utils.aoa_to_sheet(scheduleData)
    const wsDistribution = XLSX.utils.aoa_to_sheet(distributionData)

    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary')
    XLSX.utils.book_append_sheet(wb, wsSchedule, 'Schedule')
    XLSX.utils.book_append_sheet(wb, wsDistribution, 'Distribution')

    // Download
    XLSX.writeFile(wb, `night-duty-report-${monthYear}.xlsx`)
  }

  const exportToPDF = () => {
    if (!schedule) return

    if (reportFormat === 'calendar') {
      // Export calendar format using html2canvas
      const element = document.querySelector('.calendar-report')
      if (!element) return
      
      html2canvas(element as HTMLElement, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      }).then(canvas => {
        const imgData = canvas.toDataURL('image/png')
        const pdf = new jsPDF({
          orientation: 'landscape',
          unit: 'mm',
          format: 'a4'
        })
        
        const imgWidth = 297
        const imgHeight = (canvas.height * imgWidth) / canvas.width
        
        pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight)
        pdf.save(`duty-roster-${monthYear}.pdf`)
      })
      return
    }

    // Original table format export
    const monthName = new Date(monthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    
    const doc = new jsPDF()
    
    // Title
    doc.setFontSize(18)
    doc.text('Night Duty Schedule Report', 14, 20)
    
    doc.setFontSize(12)
    doc.text(`Month: ${monthName}`, 14, 30)

    // Summary
    doc.setFontSize(14)
    doc.text('Summary', 14, 45)
    doc.setFontSize(10)
    doc.text(`Total Days: ${totalDays}`, 14, 52)
    doc.text(`Filled Days: ${totalDuties}`, 14, 58)
    doc.text(`Unfilled Days: ${totalUnfilled}`, 14, 64)
    doc.text(`Fill Rate: ${totalDays > 0 ? Math.round((totalDuties / totalDays) * 100) : 0}%`, 14, 70)

    // Schedule table
    const scheduleRows = schedule.assignments.map(assignment => {
      const date = new Date(assignment.date)
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' })
      return [
        assignment.date,
        dayName,
        assignment.saintNames.join(', ') || '-',
        assignment.status
      ]
    })

    autoTable(doc, {
      startY: 80,
      head: [['Date', 'Day', 'Saints Assigned', 'Status']],
      body: scheduleRows,
      theme: 'striped',
      headStyles: { fillColor: [79, 70, 229] },
      styles: { fontSize: 8 }
    })

    // Distribution table
    const finalY = (doc as any).lastAutoTable.finalY + 10
    doc.setFontSize(14)
    doc.text('Duty Distribution', 14, finalY)

    const distributionRows = stats.map(stat => {
      const percentage = Math.round((stat.dutyCount / 2) * 100)
      return [
        stat.saintName,
        stat.saintMobile,
        stat.dutyCount,
        2,
        `${percentage}%`
      ]
    })

    autoTable(doc, {
      startY: finalY + 5,
      head: [['Saint Name', 'Phone', 'Assigned', 'Max', '%']],
      body: distributionRows,
      theme: 'striped',
      headStyles: { fillColor: [79, 70, 229] },
      styles: { fontSize: 8 }
    })

    // Download
    doc.save(`night-duty-report-${monthYear}.pdf`)
  }

  return (
    <div className="container">
      <div className="reports-header">
        <div>
          <h1>Reports & Analytics</h1>
          <p className="reports-subtitle">View duty statistics and distribution for the selected month</p>
        </div>
        <div className="date-filter">
          <label>Select Month:</label>
          <input
            type="month"
            className="input"
            value={monthYear}
            onChange={e => setSelectedMonthYear(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Loading reports...</div>
      ) : !schedule ? (
        <div className="empty-state">
          <p>No schedule found for {new Date(monthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
          <p>Generate a schedule first to view reports.</p>
        </div>
      ) : (
        <>
          <div className="report-format-toggle">
            <button 
              className={`btn ${reportFormat === 'calendar' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setReportFormat('calendar')}
            >
              Calendar View
            </button>
            <button 
              className={`btn ${reportFormat === 'table' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setReportFormat('table')}
            >
              Table View
            </button>
          </div>

          {reportFormat === 'calendar' ? (
            <CalendarReport 
              monthYear={monthYear} 
              schedule={schedule} 
              saints={saints} 
              orgDetails={orgDetails} 
            />
          ) : (
            <>
              <div className="summary-cards">
            <div className="summary-card">
              <div className="summary-icon" style={{ backgroundColor: 'rgba(79, 70, 229, 0.1)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
              </div>
              <div>
                <p className="summary-label">Total Days</p>
                <p className="summary-value">{totalDays}</p>
              </div>
            </div>

            <div className="summary-card">
              <div className="summary-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <div>
                <p className="summary-label">Filled Days</p>
                <p className="summary-value">{totalDuties}</p>
              </div>
            </div>

            <div className="summary-card">
              <div className="summary-icon" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </div>
              <div>
                <p className="summary-label">Unfilled Days</p>
                <p className="summary-value">{totalUnfilled}</p>
              </div>
            </div>

            <div className="summary-card">
              <div className="summary-icon" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M12 6v6l4 2"></path>
                </svg>
              </div>
              <div>
                <p className="summary-label">Fill Rate</p>
                <p className="summary-value">{totalDays > 0 ? Math.round((totalDuties / totalDays) * 100) : 0}%</p>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginBottom: '1.5rem' }}>Duty Distribution by Saint</h2>
            {stats.length > 0 ? (
              <div className="stats-table">
                <div className="stats-header">
                  <div>Saint</div>
                  <div>Duties Assigned</div>
                  <div>Distribution</div>
                </div>
                {stats.map((stat, index) => {
                  const maxDuties = 2
                  const percentage = (stat.dutyCount / maxDuties) * 100
                  return (
                    <div key={index} className="stats-row">
                      <div className="saint-name-col">
                        <div className="saint-name-text">{stat.saintName}</div>
                        <div className="saint-mobile-text">{stat.saintMobile}</div>
                      </div>
                      <div>{stat.dutyCount} / {maxDuties}</div>
                      <div>
                        <div className="performance-bar">
                          <div 
                            className="performance-fill" 
                            style={{ 
                              width: `${Math.min(percentage, 100)}%`,
                              backgroundColor: percentage >= 100 ? 'var(--danger)' : percentage >= 50 ? 'var(--warning)' : 'var(--success)'
                            }}
                          ></div>
                          <span className="performance-label">{Math.round(percentage)}%</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
                No duty assignments found for this month
              </p>
            )}
          </div>
            </>
          )}
        </>
      )}

      <div className="card" style={{ marginTop: '2rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Export Reports</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          Download detailed reports in various formats
        </p>
        <div className="export-buttons">
          <button className="btn btn-secondary" onClick={exportToPDF} disabled={!schedule}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Export as PDF
          </button>
          <button className="btn btn-secondary" onClick={exportToExcel} disabled={!schedule}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Export as Excel
          </button>
          <button className="btn btn-secondary" onClick={exportToCSV} disabled={!schedule}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Export as CSV
          </button>
        </div>
      </div>
    </div>
  )
}

export default Reports

