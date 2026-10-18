import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { Availability, MonthlySchedule, ScheduleAssignment, Saint } from '../../../frontend/src/types/index'
import { deliver } from './whatsapp.ts'
import {
  addMonths,
  checkExchange,
  displayName,
  dutyCount,
  istDate,
  normalizePhone,
  replaceSaintOnDate,
  within24Hours,
  type DutySlot,
} from './pure.ts'

export interface BotSaint extends Saint {
  isAdmin?: boolean
}

export interface BotAvailability extends Availability {
  respondedAt?: string
  source?: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface Pending {
  kind: 'decline_message' | 'duty_reply' | 'request_reply' | 'attendance' | 'availability'
  dutyDate?: string
  requestId?: string
  requestKind?: 'swap' | 'cover'
  monthYear?: string
  firstId?: string
  secondId?: string
}

export interface ChatDoc {
  waId: string
  saintId: string
  lastInboundAt?: string
  turns: ChatTurn[]
  pending?: Pending | null
  aiDay?: string
  aiCount?: number
}

export interface DutyDoc {
  date: string
  saintId: string
  saintName: string
  reply?: 'yes' | 'no' | null
  replyMessage?: string
  adminMark?: 'present' | 'absent' | null
}

export interface DutyRequest {
  id: string
  kind: 'swap' | 'cover'
  status: 'draft' | 'waiting' | 'accepted' | 'declined' | 'cancelled' | 'failed'
  requestedBy: string
  fromSaintId: string
  fromName: string
  toSaintId: string
  toName: string
  fromDate: string
  toDate?: string
  createdAt: string
}

const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000
let saintCache: { at: number; saints: BotSaint[] } | null = null

export function firestore(): Firestore {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Firebase admin credentials are missing')
    }
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  }
  return getFirestore()
}

function expireAt(): Timestamp {
  return Timestamp.fromDate(new Date(Date.now() + SIX_MONTHS_MS))
}

function asSaint(id: string, data: Record<string, unknown>): BotSaint {
  return {
    id,
    name: String(data.name || ''),
    mobile: String(data.mobile || ''),
    email: data.email ? String(data.email) : undefined,
    description: data.description ? String(data.description) : undefined,
    isEmergencyDuty: data.isEmergencyDuty === true,
    isUnavailableForDuty: data.isUnavailableForDuty === true,
    isAdmin: data.isAdmin === true,
    createdAt: String(data.createdAt || ''),
  }
}

export async function loadSaints(force = false): Promise<BotSaint[]> {
  if (!force && saintCache && Date.now() - saintCache.at < 5 * 60 * 1000) return saintCache.saints
  const snap = await firestore().collection('saints').get()
  const saints = snap.docs.map(doc => asSaint(doc.id, doc.data()))
  saintCache = { at: Date.now(), saints }
  return saints
}

export function clearSaintCache() {
  saintCache = null
}

export async function saintByPhone(raw: string): Promise<BotSaint | null> {
  const phone = normalizePhone(raw)
  if (!phone) return null
  const saints = await loadSaints()
  return saints.find(saint => normalizePhone(saint.mobile) === phone) || null
}

export function waIdFor(saint: BotSaint): string | null {
  return normalizePhone(saint.mobile)
}

export async function getSchedule(monthYear: string): Promise<MonthlySchedule | null> {
  const snap = await firestore().collection('schedules').doc(monthYear).get()
  if (!snap.exists) return null
  const data = snap.data() || {}
  return {
    id: snap.id,
    monthYear: String(data.monthYear || monthYear),
    generatedAt: String(data.generatedAt || ''),
    assignments: (data.assignments || []) as ScheduleAssignment[],
    warnings: data.warnings || [],
  }
}

export async function saveGeneratedSchedule(schedule: MonthlySchedule): Promise<void> {
  await firestore().collection('schedules').doc(schedule.monthYear).set({
    monthYear: schedule.monthYear,
    generatedAt: schedule.generatedAt,
    assignments: schedule.assignments,
    warnings: schedule.warnings,
  })
}

export function slotsOf(schedule: MonthlySchedule | null): DutySlot[] {
  return (schedule?.assignments || []).map(assignment => ({
    date: assignment.date,
    saintIds: assignment.saintIds || [],
  }))
}

export async function dutiesFor(saintId: string, monthYears: string[]) {
  const found: { date: string; partners: string[] }[] = []
  for (const monthYear of monthYears) {
    const schedule = await getSchedule(monthYear)
    for (const assignment of schedule?.assignments || []) {
      const index = assignment.saintIds?.indexOf(saintId) ?? -1
      if (index < 0) continue
      const partners = (assignment.saintNames || []).filter((_, i) => i !== index)
      found.push({ date: assignment.date, partners })
    }
  }
  return found.sort((a, b) => a.date.localeCompare(b.date))
}

export async function getAvailability(saintId: string, monthYear: string): Promise<BotAvailability | null> {
  const snap = await firestore().collection('availability').where('saintId', '==', saintId).get()
  const doc = snap.docs.find(item => item.data().monthYear === monthYear)
  if (!doc) return null
  return { id: doc.id, ...(doc.data() as Omit<BotAvailability, 'id'>) }
}

export async function availabilityForMonth(monthYear: string): Promise<BotAvailability[]> {
  const snap = await firestore().collection('availability').where('monthYear', '==', monthYear).get()
  return snap.docs.map(doc => ({ id: doc.id, ...(doc.data() as Omit<BotAvailability, 'id'>) }))
}

export async function saveAvailability(input: {
  saintId: string
  monthYear: string
  unavailableDates: string[]
  unavailableDays: string[]
  availableDates: string[]
  availableDays: string[]
  partnerPreferences: string[]
  dateSpecificPartners: { date: string; partnerId: string }[]
}): Promise<void> {
  const existing = await getAvailability(input.saintId, input.monthYear)
  const payload = {
    saintId: input.saintId,
    monthYear: input.monthYear,
    unavailableDates: input.unavailableDates,
    unavailableDays: input.unavailableDays,
    availableDates: input.availableDates,
    availableDays: input.availableDays,
    partnerPreferences: input.partnerPreferences,
    dateSpecificPartners: input.dateSpecificPartners,
    isEmergencyDuty: existing?.isEmergencyDuty === true,
    respondedAt: new Date().toISOString(),
    source: 'whatsapp',
  }
  if (existing) {
    await firestore().collection('availability').doc(existing.id).update(payload)
  } else {
    await firestore().collection('availability').add(payload)
  }
}

function chatRef(waId: string) {
  return firestore().collection('chats').doc(waId)
}

export async function getChat(waId: string, saintId: string): Promise<ChatDoc> {
  const snap = await chatRef(waId).get()
  if (!snap.exists) {
    return { waId, saintId, turns: [], pending: null, aiCount: 0 }
  }
  const data = snap.data() || {}
  return {
    waId,
    saintId,
    lastInboundAt: data.lastInboundAt,
    turns: Array.isArray(data.turns) ? data.turns.slice(-8) : [],
    pending: data.pending || null,
    aiDay: data.aiDay,
    aiCount: Number(data.aiCount || 0),
  }
}

export async function saveChat(chat: ChatDoc, patch: Partial<ChatDoc>): Promise<ChatDoc> {
  const next: ChatDoc = {
    ...chat,
    ...patch,
    turns: (patch.turns || chat.turns).slice(-8),
  }
  await chatRef(chat.waId).set({
    ...next,
    expireAt: expireAt(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return next
}

export async function noteInbound(waId: string, saintId: string): Promise<ChatDoc> {
  const chat = await getChat(waId, saintId)
  return saveChat(chat, { lastInboundAt: new Date().toISOString(), saintId })
}

export async function claimInbox(wamid: string, waId: string, text: string): Promise<boolean> {
  const ref = firestore().collection('inbox').doc(wamid)
  return firestore().runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (snap.exists) return false
    tx.set(ref, { waId, text: text.slice(0, 1000), at: new Date().toISOString(), expireAt: expireAt() })
    return true
  })
}

export function dutyId(date: string, saintId: string): string {
  return `${date}_${saintId}`
}

export async function getDuty(date: string, saintId: string): Promise<DutyDoc | null> {
  const snap = await firestore().collection('duties').doc(dutyId(date, saintId)).get()
  if (!snap.exists) return null
  return snap.data() as DutyDoc
}

export async function saveDuty(duty: DutyDoc): Promise<void> {
  await firestore().collection('duties').doc(dutyId(duty.date, duty.saintId)).set({
    ...duty,
    expireAt: expireAt(),
  }, { merge: true })
}

export async function dutiesOn(date: string, saintIds: string[], names: string[]): Promise<DutyDoc[]> {
  const docs: DutyDoc[] = []
  for (let i = 0; i < saintIds.length; i++) {
    const existing = await getDuty(date, saintIds[i])
    docs.push(existing || { date, saintId: saintIds[i], saintName: names[i] || '' })
  }
  return docs
}

export async function createRequest(input: Omit<DutyRequest, 'id' | 'createdAt' | 'status'> & { status?: DutyRequest['status'] }): Promise<DutyRequest> {
  const ref = firestore().collection('requests').doc()
  const request: DutyRequest = {
    ...input,
    id: ref.id,
    status: input.status || 'draft',
    createdAt: new Date().toISOString(),
  }
  await ref.set({ ...request, expireAt: expireAt() })
  return request
}

export async function getRequest(id: string): Promise<DutyRequest | null> {
  const snap = await firestore().collection('requests').doc(id).get()
  if (!snap.exists) return null
  return { id: snap.id, ...(snap.data() as Omit<DutyRequest, 'id'>) }
}

export async function setRequestStatus(id: string, status: DutyRequest['status']): Promise<void> {
  await firestore().collection('requests').doc(id).update({ status })
}

export async function transitionRequest(id: string, from: DutyRequest['status'], to: DutyRequest['status']): Promise<boolean> {
  const ref = firestore().collection('requests').doc(id)
  return firestore().runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (snap.data()?.status !== from) return false
    tx.update(ref, { status: to })
    return true
  })
}

export async function openRequestsFor(saintId: string): Promise<DutyRequest[]> {
  const snap = await firestore().collection('requests')
    .where('status', 'in', ['draft', 'waiting'])
    .limit(50)
    .get()
  return snap.docs
    .map(doc => ({ id: doc.id, ...(doc.data() as Omit<DutyRequest, 'id'>) }))
    .filter(request => request.requestedBy === saintId || request.fromSaintId === saintId || request.toSaintId === saintId)
}

export async function claimJob(day: string, job: string): Promise<boolean> {
  const ref = firestore().collection('jobRuns').doc(`${day}-${job}`)
  return firestore().runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (snap.exists) return false
    tx.set(ref, { day, job, at: new Date().toISOString(), expireAt: expireAt() })
    return true
  })
}

export async function purgeExpired(): Promise<number> {
  const db = firestore()
  const now = Timestamp.now()
  let removed = 0
  for (const name of ['chats', 'inbox', 'duties', 'requests', 'jobRuns']) {
    const snap = await db.collection(name).where('expireAt', '<', now).limit(400).get()
    if (snap.empty) continue
    const batch = db.batch()
    snap.docs.forEach(doc => batch.delete(doc.ref))
    await batch.commit()
    removed += snap.size
  }
  return removed
}

export async function commitExchange(request: DutyRequest, today = istDate()): Promise<{ ok: true } | { ok: false; reason: string }> {
  const months = [...new Set([request.fromDate.slice(0, 7), (request.toDate || request.fromDate).slice(0, 7)])]
  const db = firestore()
  const requestRef = db.collection('requests').doc(request.id)
  return db.runTransaction(async tx => {
    const requestSnap = await tx.get(requestRef)
    if (requestSnap.data()?.status !== 'waiting') {
      return { ok: false as const, reason: 'That request is no longer open.' }
    }
    const refs = months.map(month => db.collection('schedules').doc(month))
    const snaps = []
    for (const ref of refs) snaps.push(await tx.get(ref))
    const schedules = snaps.map((snap, index) => {
      if (!snap.exists) return null
      return { ref: refs[index], data: snap.data() as MonthlySchedule }
    })
    const slots: DutySlot[] = []
    for (const schedule of schedules) {
      if (!schedule) continue
      slots.push(...(schedule.data.assignments || []).map(assignment => ({
        date: assignment.date,
        saintIds: assignment.saintIds || [],
      })))
    }
    const monthSlots = slots.filter(slot => slot.date.startsWith(request.fromDate.slice(0, 7)))
    const verdict = checkExchange({
      today,
      kind: request.kind,
      fromId: request.fromSaintId,
      toId: request.toSaintId,
      fromDate: request.fromDate,
      toDate: request.toDate,
      slots,
      toDutyCount: dutyCount(monthSlots, request.toSaintId),
    })
    if (!verdict.ok) return verdict

    for (const schedule of schedules) {
      if (!schedule) continue
      let assignments = schedule.data.assignments || []
      if (request.kind === 'swap' && request.toDate) {
        assignments = replaceSaintOnDate(assignments, request.fromDate, request.fromSaintId, request.toSaintId, request.toName)
        assignments = replaceSaintOnDate(assignments, request.toDate, request.toSaintId, request.fromSaintId, request.fromName)
      } else {
        assignments = replaceSaintOnDate(assignments, request.fromDate, request.fromSaintId, request.toSaintId, request.toName)
      }
      tx.update(schedule.ref, { assignments })
    }
    tx.update(db.collection('requests').doc(request.id), { status: 'accepted' })
    return { ok: true as const }
  })
}

export function recentMonths(today: string, count: number): string[] {
  const start = today.slice(0, 7)
  const months = [start]
  for (let i = 1; i < count; i++) months.push(addMonths(start, -i))
  return months
}

export function personLabel(saint: BotSaint): string {
  return displayName(saint)
}

export async function alertAdmins(text: string, exceptId?: string): Promise<void> {
  const saints = await loadSaints()
  for (const admin of saints.filter(saint => saint.isAdmin && saint.id !== exceptId)) {
    const to = waIdFor(admin)
    if (!to) continue
    const chat = await getChat(to, admin.id)
    try {
      await deliver({
        to,
        windowOpen: within24Hours(chat.lastInboundAt),
        text,
        templateName: 'duty_update',
        templateParams: [text],
      })
    } catch (error) {
      console.error('admin alert failed', admin.id, error)
    }
  }
}
