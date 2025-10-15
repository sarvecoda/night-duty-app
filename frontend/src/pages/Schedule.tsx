import { useState, useEffect } from 'react'
import { MonthlySchedule, ScheduleWarning } from '../types'
import type { Saint } from '../types'
import { scheduleAPI } from '../services/api'
import { useAppContext } from '../contexts/AppContext'
import { useToast } from '../contexts/ToastContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import CalendarGrid from '../components/CalendarGrid'
import { getEmergencySaintIds, getEmergencyWarning } from '../utils/emergencyUtils'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import './Schedule.css'

function Schedule() {
  const { saints: allSaints, loading: saintsLoading, selectedMonthYear: monthYear } = useAppContext()
  const { showToast } = useToast()
  const [schedule, setSchedule] = useState<MonthlySchedule | null>(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showWarningsModal, setShowWarningsModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingDate, setEditingDate] = useState('')
  const [editFormData, setEditFormData] = useState({
    saint1: '',
    saint2: ''
  })
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    title: string
    message: string
    type: 'warning' | 'danger' | 'info'
    onConfirm: () => void
  } | null>(null)
  const [emergencySaintIds, setEmergencySaintIds] = useState<Set<string>>(new Set())

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
      fetchSchedule()
    }
  }, [monthYear, saintsLoading])

  const fetchSchedule = async () => {
    setLoading(true)
    try {
      const response = await scheduleAPI.getByMonth(monthYear)
      setSchedule(response.data)
    } catch (error: any) {
      if (error.response?.status === 404) {
        setSchedule(null)
      } else {
        console.error('Error fetching schedule:', error)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateScheduleRequest = async () => {
    // Check emergency saints count (from availability documents for current month)
    let emergencyWarning = ''
    try {
      const { warning } = await getEmergencyWarning(monthYear)
      emergencyWarning = warning
    } catch (error) {
      console.error('Error checking emergency saints:', error)
      // Don't block on error, just log it
    }

    if (schedule) {
      setConfirmDialog({
        isOpen: true,
        title: 'Regenerate Schedule?',
        message: `A schedule already exists for this month. Generating a new schedule will replace it. All current assignments will be lost.${emergencyWarning}`,
        type: 'danger',
        onConfirm: () => {
          handleGenerateSchedule()
          setConfirmDialog(null)
        }
      })
    } else {
      setConfirmDialog({
        isOpen: true,
        title: 'Generate Schedule?',
        message: `This will create a new schedule for the selected month.${emergencyWarning}`,
        type: 'warning',
        onConfirm: () => {
          handleGenerateSchedule()
          setConfirmDialog(null)
        }
      })
    }
  }

  const handleGenerateSchedule = async () => {
    setGenerating(true)
    try {
      const response = await scheduleAPI.generate(monthYear)
      setSchedule(response.data)
      showToast('Schedule generated successfully', 'success')
      if (response.data.warnings.length > 0) {
        setShowWarningsModal(true)
      }
    } catch (error) {
      console.error('Error generating schedule:', error)
      showToast('Failed to generate schedule', 'error')
    } finally {
      setGenerating(false)
    }
  }

  const handleEditAssignment = (date: string) => {
    const assignment = schedule?.assignments.find(a => a.date === date)
    setEditingDate(date)
    setEditFormData({
      saint1: assignment?.saintIds[0] || '',
      saint2: assignment?.saintIds[1] || ''
    })
    setShowEditModal(true)
  }

  const handleSaveEdit = async () => {
    if (!editingDate) return

    const selectedSaints = saints.filter(s =>
      [editFormData.saint1, editFormData.saint2].includes(s.id)
    )

    try {
      await scheduleAPI.updateAssignment(monthYear, editingDate, {
        saintIds: selectedSaints.map(s => s.id),
        saintNames: selectedSaints.map(s => s.name)
      })
      await fetchSchedule()
      setShowEditModal(false)
      setEditingDate('')
      showToast('Assignment updated successfully', 'success')
    } catch (error) {
      console.error('Error updating assignment:', error)
      showToast('Failed to update assignment', 'error')
    }
  }

  const handleDeleteScheduleRequest = () => {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Schedule?',
      message: 'Are you sure you want to delete this schedule? This action cannot be undone.',
      type: 'danger',
      onConfirm: () => {
        handleDeleteSchedule()
        setConfirmDialog(null)
      }
    })
  }

  const handleDeleteSchedule = async () => {
    try {
      await scheduleAPI.delete(monthYear)
      setSchedule(null)
      showToast('Schedule deleted successfully', 'success')
    } catch (error) {
      console.error('Error deleting schedule:', error)
      showToast('Failed to delete schedule', 'error')
    }
  }

  const handleExportCalendar = async () => {
    const calendarElement = document.querySelector('.card') as HTMLElement
    if (!calendarElement) return
    
    try {
      const canvas = await html2canvas(calendarElement, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false
      })
      
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF('l', 'mm', 'a4') // landscape orientation
      const imgWidth = 297 // A4 landscape width in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight)
      pdf.save(`night-duty-schedule-${monthYear}.pdf`)
    } catch (error) {
      console.error('Error exporting calendar:', error)
    }
  }

  const unfilledCount = schedule?.assignments.filter(a => a.status !== 'filled').length || 0
  const totalDays = schedule?.assignments.length || 0

  return (
    <div className="container">
      <div className="schedule-header">
        <div>
          <h1>Duty Schedule</h1>
          <p className="schedule-subtitle">Generate and manage monthly night duty assignments</p>
          {schedule && (
            <div className="schedule-stats">
              <span className="stat-item">
                <span className="stat-label">Total Days:</span> {totalDays}
              </span>
              <span className="stat-item">
                <span className="stat-label">Filled:</span> {totalDays - unfilledCount}
              </span>
              {unfilledCount > 0 && (
                <span className="stat-item warning">
                  <span className="stat-label">Unfilled:</span> {unfilledCount}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Loading schedule...</div>
      ) : schedule ? (
        <>
          <div className="schedule-actions">
            <button
              className="btn btn-primary"
              onClick={handleGenerateScheduleRequest}
              disabled={generating}
            >
              {generating ? 'Generating...' : 'Regenerate Schedule'}
            </button>
            {schedule.warnings.length > 0 && (
              <button
                className="btn btn-secondary"
                onClick={() => setShowWarningsModal(true)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                View Warnings ({schedule.warnings.length})
              </button>
            )}
            <button className="btn btn-secondary" onClick={handleExportCalendar}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Export
            </button>
            <button className="btn btn-secondary btn-danger" onClick={handleDeleteScheduleRequest}>
              Delete Schedule
            </button>
          </div>

          <div className="card">
            <CalendarGrid
              monthYear={monthYear}
              assignments={schedule.assignments}
              onEditAssignment={handleEditAssignment}
            />
          </div>
        </>
      ) : (
        <div className="empty-schedule-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <h3>No Schedule Generated</h3>
          <p>Generate a schedule for {new Date(monthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
          <button
            className="btn btn-primary"
            onClick={handleGenerateScheduleRequest}
            disabled={generating}
          >
            {generating ? 'Generating...' : 'Generate Schedule'}
          </button>
        </div>
      )}

      {showWarningsModal && schedule && (
        <WarningsModal
          warnings={schedule.warnings}
          onClose={() => setShowWarningsModal(false)}
        />
      )}

      {showEditModal && (
        <EditAssignmentModal
          date={editingDate}
          saints={saints}
          formData={editFormData}
          onChange={setEditFormData}
          onSave={handleSaveEdit}
          onClose={() => setShowEditModal(false)}
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

interface WarningsModalProps {
  warnings: ScheduleWarning[]
  onClose: () => void
}

function WarningsModal({ warnings, onClose }: WarningsModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Schedule Warnings</h2>
          <button className="btn-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="warnings-content">
          {warnings.map((warning, index) => (
            <div key={index} className={`warning-item ${warning.type}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <div>
                <p className="warning-message">{warning.message}</p>
                {warning.date && <p className="warning-date">Date: {new Date(warning.date + 'T00:00:00').toLocaleDateString()}</p>}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

interface EditAssignmentModalProps {
  date: string
  saints: Saint[]
  formData: { saint1: string; saint2: string }
  onChange: (data: { saint1: string; saint2: string }) => void
  onSave: () => void
  onClose: () => void
}

function EditAssignmentModal({ date, saints, formData, onChange, onSave, onClose }: EditAssignmentModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Assignment - {new Date(date + 'T00:00:00').toLocaleDateString()}</h2>
          <button className="btn-close" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onSave(); }}>
          <div className="form-group">
            <label>Saint 1</label>
            <select
              className="input"
              value={formData.saint1}
              onChange={e => onChange({ ...formData, saint1: e.target.value })}
            >
              <option value="">None</option>
              {saints.map(member => (
                <option key={member.id} value={member.id} disabled={member.id === formData.saint2}>
                  {member.name} {member.description ? `(${member.description})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Saint 2</label>
            <select
              className="input"
              value={formData.saint2}
              onChange={e => onChange({ ...formData, saint2: e.target.value })}
            >
              <option value="">None</option>
              {saints.map(member => (
                <option key={member.id} value={member.id} disabled={member.id === formData.saint1}>
                  {member.name} {member.description ? `(${member.description})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Assignment
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default Schedule
