import { db } from '../config/firebase'
import { 
  collection, 
  getDocs, 
  getDoc, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  setDoc,
  limit
} from 'firebase/firestore'
import { Saint, Availability, MonthlySchedule, ScheduleAssignment } from '../types'
import { generateMonthlySchedule } from './scheduleGenerator'

// Saints APIs
export const saintsAPI = {
  getAll: async () => {
    const snapshot = await getDocs(collection(db, 'saints'))
    return { data: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Saint)) }
  },
  
  getEmergency: async () => {
    const q = query(collection(db, 'saints'), where('isEmergencyDuty', '==', true))
    const snapshot = await getDocs(q)
    return { data: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Saint)) }
  },
  
  getById: async (id: string) => {
    const docRef = doc(db, 'saints', id)
    const docSnap = await getDoc(docRef)
    if (!docSnap.exists()) {
      throw new Error('Saint not found')
    }
    return { data: { id: docSnap.id, ...docSnap.data() } as Saint }
  },
  
  create: async (saint: Omit<Saint, 'id' | 'createdAt'>) => {
    const saintData = {
      ...saint,
      createdAt: new Date().toISOString()
    }
    const docRef = await addDoc(collection(db, 'saints'), saintData)
    const newDoc = await getDoc(docRef)
    return { data: { id: newDoc.id, ...newDoc.data() } as Saint }
  },
  
  update: async (id: string, saint: Partial<Saint>) => {
    const docRef = doc(db, 'saints', id)
    await updateDoc(docRef, saint)
    const updated = await getDoc(docRef)
    return { data: { id: updated.id, ...updated.data() } as Saint }
  },
  
  delete: async (id: string) => {
    await deleteDoc(doc(db, 'saints', id))
    return { data: null }
  },
}

// Keep old name for compatibility during transition
export const staffAPI = saintsAPI

// Availability APIs
export const availabilityAPI = {
  getAll: async () => {
    const snapshot = await getDocs(collection(db, 'availability'))
    return { data: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Availability)) }
  },

  getByMonth: async (monthYear: string) => {
    const q = query(collection(db, 'availability'), where('monthYear', '==', monthYear))
    const snapshot = await getDocs(q)
    return { data: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Availability)) }
  },
  
  getBySaintAndMonth: async (monthYear: string, saintId: string) => {
    const q = query(
      collection(db, 'availability'),
      where('monthYear', '==', monthYear),
      where('saintId', '==', saintId),
      limit(1)
    )
    const snapshot = await getDocs(q)
    
    if (snapshot.empty) {
      throw new Error('Availability not found')
    }
    
    const docSnap = snapshot.docs[0]
    return { data: { id: docSnap.id, ...docSnap.data() } as Availability }
  },
  
  create: async (availability: Omit<Availability, 'id'>) => {
    // Check if availability already exists for this saint/month
    const q = query(
      collection(db, 'availability'),
      where('monthYear', '==', availability.monthYear),
      where('saintId', '==', availability.saintId)
    )
    const existing = await getDocs(q)
    
    if (!existing.empty) {
      throw new Error('Availability already exists for this saint and month')
    }
    
    const docRef = await addDoc(collection(db, 'availability'), availability)
    const newDoc = await getDoc(docRef)
    return { data: { id: newDoc.id, ...newDoc.data() } as Availability }
  },
  
  update: async (id: string, availability: Partial<Availability>) => {
    const docRef = doc(db, 'availability', id)
    await updateDoc(docRef, availability)
    const updated = await getDoc(docRef)
    return { data: { id: updated.id, ...updated.data() } as Availability }
  },
  
  delete: async (id: string) => {
    await deleteDoc(doc(db, 'availability', id))
    return { data: null }
  },
}

// Schedule APIs
export const scheduleAPI = {
  generate: async (monthYear: string) => {
    // Get all saints
    const saintsResponse = await saintsAPI.getAll()
    const saints = saintsResponse.data
    
    // Get all availability for this month
    const availabilityResponse = await availabilityAPI.getByMonth(monthYear)
    const availabilities = new Map<string, Availability>()
    availabilityResponse.data.forEach(a => availabilities.set(a.saintId, a))
    
    // Generate schedule
    const schedule = generateMonthlySchedule({ saints, availabilities, monthYear })
    
    // Save to Firestore
    const docRef = doc(db, 'schedules', monthYear)
    await setDoc(docRef, {
      monthYear: schedule.monthYear,
      generatedAt: schedule.generatedAt,
      assignments: schedule.assignments,
      warnings: schedule.warnings
    })
    
    return { data: schedule }
  },
  
  getByMonth: async (monthYear: string) => {
    const docRef = doc(db, 'schedules', monthYear)
    const docSnap = await getDoc(docRef)
    
    if (!docSnap.exists()) {
      throw new Error('Schedule not found')
    }
    
    return { data: { id: docSnap.id, ...docSnap.data() } as MonthlySchedule }
  },
  
  updateAssignment: async (monthYear: string, date: string, assignment: Partial<ScheduleAssignment>) => {
    const docRef = doc(db, 'schedules', monthYear)
    const docSnap = await getDoc(docRef)
    
    if (!docSnap.exists()) {
      throw new Error('Schedule not found')
    }
    
    const schedule = docSnap.data() as MonthlySchedule
    const assignmentIndex = schedule.assignments.findIndex(a => a.date === date)
    
    if (assignmentIndex === -1) {
      throw new Error('Assignment not found')
    }
    
    // Update the specific assignment
    schedule.assignments[assignmentIndex] = {
      ...schedule.assignments[assignmentIndex],
      ...assignment,
      manuallyEdited: true
    }
    
    await updateDoc(docRef, { assignments: schedule.assignments })
    
    return { data: schedule.assignments[assignmentIndex] }
  },
  
  delete: async (monthYear: string) => {
    await deleteDoc(doc(db, 'schedules', monthYear))
    return { data: null }
  },
}

export default { saintsAPI, staffAPI, availabilityAPI, scheduleAPI }
