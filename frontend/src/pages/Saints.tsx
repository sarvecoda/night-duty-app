import { useState, useEffect } from 'react'
import { Saint } from '../types'
import { saintsAPI } from '../services/api'
import { useAppContext } from '../contexts/AppContext'
import { useToast } from '../contexts/ToastContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { getSaintInitials } from '../utils/nameUtils'
import { getEmergencySaintIds } from '../utils/emergencyUtils'
import './Saints.css'

function Saints() {
  const { saints, loading, refreshSaints, selectedMonthYear: monthYear } = useAppContext()
  const { showToast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [editingSaints, setEditingSaints] = useState<Saint | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    mobile: '',
    email: '',
    description: '',
    isUnavailableForDuty: false,
    isEmergencyDuty: false
  })
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean
    title: string
    message: string
    type: 'warning' | 'danger' | 'info'
    onConfirm: () => void
  } | null>(null)
  const [emergencySaintIds, setEmergencySaintIds] = useState<Set<string>>(new Set())

  // Fetch emergency status when month changes
  useEffect(() => {
    const fetchEmergencyStatus = async () => {
      if (loading) return
      
      try {
        const emergencyIds = await getEmergencySaintIds(monthYear)
        setEmergencySaintIds(emergencyIds)
      } catch (error) {
        console.error('Error fetching emergency status:', error)
      }
    }
    
    fetchEmergencyStatus()
  }, [monthYear, loading])

  const hasDuplicateName = (name: string, excludeId?: string) => {
    return saints.filter(s => s.id !== excludeId && s.name.toLowerCase() === name.toLowerCase()).length > 0
  }

  const showDescriptionField = formData.name && hasDuplicateName(formData.name, editingSaints?.id)

  const handleSubmitRequest = (e: React.FormEvent) => {
    e.preventDefault()
    
    const message = editingSaints 
      ? 'This will update the saint information and may affect existing schedules.'
      : 'This will add a new saint to the roster.'
    
    setConfirmDialog({
      isOpen: true,
      title: editingSaints ? 'Update Saint?' : 'Add Saint?',
      message: message,
      type: 'warning',
      onConfirm: () => {
        handleSubmit(e)
        setConfirmDialog(null)
      }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const saintsData: any = {
        name: formData.name,
        mobile: formData.mobile,
        isUnavailableForDuty: formData.isUnavailableForDuty
      }

      // Only include email if it has a value
      if (formData.email && formData.email.trim()) {
        saintsData.email = formData.email
      }

      // Only include description if it's needed and has a value
      if (showDescriptionField && formData.description && formData.description.trim()) {
        saintsData.description = formData.description
      }

      // If marking as unavailable (and wasn't before), clear all availability preferences
      if (formData.isUnavailableForDuty && editingSaints && !editingSaints.isUnavailableForDuty) {
        try {
          // Import Firebase to query all availability records for this saint
          const { collection, query, where, getDocs, updateDoc, doc } = await import('firebase/firestore')
          const { db } = await import('../config/firebase')
          
          const q = query(collection(db, 'availability'), where('saintId', '==', editingSaints.id))
          const snapshot = await getDocs(q)
          
          const updatePromises = snapshot.docs.map(docSnap => 
            updateDoc(doc(db, 'availability', docSnap.id), {
              unavailableDates: [],
              unavailableDays: [],
              availableDates: [],
              availableDays: [],
              partnerPreferences: [],
              dateSpecificPartners: []
            })
          )
          
          if (updatePromises.length > 0) {
            await Promise.all(updatePromises)
            showToast('Availability preferences cleared for unavailable saint', 'info')
          }
        } catch (error) {
          console.error('Error clearing availability:', error)
          // Don't fail the saint update if clearing availability fails
        }
      }

      if (editingSaints) {
        await saintsAPI.update(editingSaints.id, saintsData)
        showToast('Saint updated successfully', 'success')
      } else {
        await saintsAPI.create(saintsData)
        showToast('Saint added successfully', 'success')
      }

      await refreshSaints()
      
      // Update emergency status in availability for current month
      if (editingSaints) {
        const { availabilityAPI } = await import('../services/api')
        const wasEmergency = emergencySaintIds.has(editingSaints.id)
        
        if (formData.isEmergencyDuty !== wasEmergency) {
          // Fetch current month availability
          const availabilities = await availabilityAPI.getByMonth(monthYear)
          const existingAvail = availabilities.data.find(a => a.saintId === editingSaints.id)
          
          if (existingAvail) {
            await availabilityAPI.update(existingAvail.id, {
              isEmergencyDuty: formData.isEmergencyDuty
            })
          } else {
            // Create new availability record
            await availabilityAPI.create({
              saintId: editingSaints.id,
              monthYear,
              unavailableDates: [],
              unavailableDays: [],
              availableDates: [],
              availableDays: [],
              partnerPreferences: [],
              dateSpecificPartners: [],
              isEmergencyDuty: formData.isEmergencyDuty
            })
          }
        }
      }
      
      // Refresh emergency status
      const { availabilityAPI } = await import('../services/api')
      const availabilityResponse = await availabilityAPI.getByMonth(monthYear)
      const emergencyIds = new Set(
        availabilityResponse.data
          .filter(avail => avail.isEmergencyDuty === true)
          .map(avail => avail.saintId)
      )
      setEmergencySaintIds(emergencyIds)
      
      handleCloseModal()
    } catch (error) {
      console.error('Error saving saints:', error)
      showToast('Failed to save saint', 'error')
    }
  }

  const handleEdit = (member: Saint) => {
    setEditingSaints(member)
    setFormData({
      name: member.name,
      mobile: member.mobile,
      email: member.email || '',
      description: member.description || '',
      isUnavailableForDuty: member.isUnavailableForDuty,
      isEmergencyDuty: emergencySaintIds.has(member.id)
    })
    setShowModal(true)
  }

  const handleDeleteRequest = (member: Saint) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Saint?',
      message: `Are you sure you want to delete ${member.name}? This will remove all their availability data and cannot be undone.`,
      type: 'danger',
      onConfirm: () => {
        handleDelete(member.id)
        setConfirmDialog(null)
      }
    })
  }

  const handleDelete = async (id: string) => {
    try {
      await saintsAPI.delete(id)
      await refreshSaints()
      showToast('Saint deleted successfully', 'success')
    } catch (error) {
      console.error('Error deleting saint:', error)
      showToast('Failed to delete saint', 'error')
    }
  }

  const handleCloseModal = () => {
    setShowModal(false)
    setEditingSaints(null)
    setFormData({
      name: '',
      mobile: '',
      email: '',
      description: '',
      isUnavailableForDuty: false,
      isEmergencyDuty: false
    })
  }

  // Filter saints based on search query (emergency is per-month now, so show all saints together)
  const filteredSaints = saints.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.mobile.includes(searchQuery)
  )

  if (loading && saints.length === 0) {
    return (
      <div className="container">
        <div className="empty-state">Loading saints...</div>
      </div>
    )
  }

  return (
    <div className="container">
      <div className="saints-header">
        <div>
          <h1>Saints Management</h1>
          <p className="saints-subtitle">Manage your team members and their availability. Emergency duty is set per-month in Availability tab.</p>
          <div className="saints-stats">
            <span>Total: {saints.length}</span>
            <span>Emergency ({new Date(monthYear + '-01').toLocaleDateString('en-US', { month: 'short' })}): {emergencySaintIds.size}</span>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          Add Saints
        </button>
      </div>

      <input
        type="text"
        className="input search-input"
        placeholder="Search saints by name or phone..."
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
      />

      <div className="saints-section">
        <h2 className="section-title">All Saints {searchQuery && `(${filteredSaints.length})`}</h2>
        {filteredSaints.length > 0 ? (
          <div className="saints-grid">
            {filteredSaints.map(member => (
              <SaintsCard 
                key={member.id} 
                member={member} 
                onEdit={handleEdit} 
                onDelete={() => handleDeleteRequest(member)}
                isEmergency={emergencySaintIds.has(member.id)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            {searchQuery ? (
              <p>No saints found matching "{searchQuery}"</p>
            ) : (
              <>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                <h3>No Saints Yet</h3>
                <p>Start by adding your first saint member</p>
              </>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingSaints ? 'Edit Saints Member' : 'Add Saints Member'}</h2>
              <button className="btn-close" onClick={handleCloseModal}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <form onSubmit={handleSubmitRequest}>
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  className="input"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              {showDescriptionField && (
                <div className="form-group">
                  <label>Description (to distinguish from duplicate name) *</label>
                  <input
                    type="text"
                    className="input"
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    placeholder="e.g., Night shift, Ward A"
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label>Mobile Number *</label>
                <input
                  type="tel"
                  className="input"
                  value={formData.mobile}
                  onChange={e => setFormData({ ...formData, mobile: e.target.value })}
                  placeholder="+1234567890"
                  required
                />
              </div>
              <div className="form-group">
                <label>Email (Optional)</label>
                <input
                  type="email"
                  className="input"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  placeholder="email@example.com"
                />
              </div>
              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.isEmergencyDuty}
                    onChange={e => setFormData({ 
                      ...formData, 
                      isEmergencyDuty: e.target.checked,
                      isUnavailableForDuty: false  // Can't be both
                    })}
                    disabled={formData.isUnavailableForDuty}
                  />
                  <span>Mark as Emergency Duty (for {new Date(monthYear + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })})</span>
                </label>
                <p className="help-text">
                  Emergency saints are available anytime for this month but won't be in regular rotation
                </p>
              </div>
              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.isUnavailableForDuty}
                    onChange={e => setFormData({ 
                      ...formData, 
                      isUnavailableForDuty: e.target.checked,
                      isEmergencyDuty: false  // Can't be both
                    })}
                    disabled={formData.isEmergencyDuty}
                  />
                  <span>Not Available for Night Duty</span>
                </label>
                <p className="help-text">
                  Mark this saint as completely unavailable (card will be red in Availability tab)
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingSaints ? 'Update Saints' : 'Add Saints'}
                </button>
              </div>
            </form>
          </div>
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

interface SaintsCardProps {
  member: Saint
  onEdit: (member: Saint) => void
  onDelete: () => void
  isEmergency: boolean
}

function SaintsCard({ member, onEdit, onDelete, isEmergency }: SaintsCardProps) {
  return (
    <div className="saints-card">
      {isEmergency && (
        <div className="emergency-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          Emergency (This Month)
        </div>
      )}
      {member.isUnavailableForDuty && (
        <div className="unavailable-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
          Not Available
        </div>
      )}
      <div className="saints-avatar">
        {getSaintInitials(member.name)}
      </div>
      <div className="saints-info">
        <h3>{member.name}</h3>
        {member.description && <p className="saints-description">{member.description}</p>}
        <div className="saints-contact">
          <div className="contact-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
            </svg>
            {member.mobile}
          </div>
          {member.email && (
            <div className="contact-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                <polyline points="22,6 12,13 2,6"></polyline>
              </svg>
              {member.email}
            </div>
          )}
        </div>
      </div>
      <div className="saints-actions">
        <button
          className="btn-icon"
          title="Edit"
          onClick={e => {
            e.stopPropagation();
            onEdit(member);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button className="btn-icon btn-danger" title="Delete" onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>
  )
}

export default Saints

