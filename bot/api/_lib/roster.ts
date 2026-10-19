import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { Availability, MonthlySchedule, ScheduleAssignment, Saint } from '../../../frontend/src/types/index'
import { deliver } from './whatsapp.js'
import {
  addMonths,
  checkExchange,
  displayName,
  dutyCount,
  istDate,
  knownCollection,
  normalizePhone,
  replaceSaintOnDate,
  within24Hours,
  type DutySlot,
} from './pure.js'

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

const QUERY_READ_CAP = 1000
const STORED_EQUALS: Record<string, string[]> = {
  saints: ['name', 'mobile', 'email', 'isEmergencyDuty', 'isUnavailableForDuty', 'isAdmin'],
  availability: ['saintId', 'monthYear', 'isEmergencyDuty', 'source'],
  duties: ['date', 'saintId', 'saintName', 'reply', 'adminMark'],
  requests: ['kind', 'status', 'fromSaintId', 'toSaintId', 'fromDate', 'requestedBy'],
  inbox: ['waId'],
  chats: ['waId', 'saintId'],
  jobRuns: ['day', 'job'],
}

function plainValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  if (Array.isArray(value)) return value.map(plainValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, plainValue(item)]))
  }
  return value ?? ''
}

function namesFor(ids: unknown, byId: Map<string, string>): string[] {
  if (!Array.isArray(ids)) return []
  return ids.map(id => byId.get(String(id)) || String(id))
}

export async function loadQueryRows(collection: string, equals?: { field: string; value: unknown }): Promise<Record<string, unknown>[]> {
  if (!knownCollection(collection)) throw new Error(`Unknown collection "${collection}"`)
  const saints = await loadSaints()
  const byId = new Map(saints.map(saint => [saint.id, saint.name]))
  const byPhone = new Map(saints.flatMap(saint => {
    const phone = normalizePhone(saint.mobile)
    return phone ? [[phone, saint.name] as const] : []
  }))
  if (collection === 'assignments' || collection === 'chart_warnings') {
    return scheduleRows(collection, byId)
  }
  const base = firestore().collection(collection)
  const query = equals && STORED_EQUALS[collection]?.includes(equals.field) && equals.value !== undefined
    ? base.where(equals.field, '==', equals.value).limit(QUERY_READ_CAP)
    : base.limit(QUERY_READ_CAP)
  const snap = await query.get()
  return snap.docs.map(doc => readableRow(collection, doc.id, doc.data() as Record<string, unknown>, byId, byPhone))
}

async function scheduleRows(kind: string, byId: Map<string, string>): Promise<Record<string, unknown>[]> {
  const snap = await firestore().collection('schedules').limit(QUERY_READ_CAP).get()
  const rows: Record<string, unknown>[] = []
  for (const doc of snap.docs) {
    const data = doc.data()
    const month = String(data.monthYear || doc.id)
    const source = kind === 'assignments' ? data.assignments : data.warnings
    for (const item of Array.isArray(source) ? source : []) {
      const row = item as Record<string, unknown>
      if (kind === 'assignments') {
        const names = Array.isArray(row.saintNames) ? row.saintNames.map(String) : []
        rows.push({
          month,
          date: String(row.date || ''),
          names: names.join(', '),
          saintNames: names,
          ids: Array.isArray(row.saintIds) ? row.saintIds.map(String) : [],
          status: String(row.status || ''),
          edited: row.manuallyEdited === true,
        })
      } else {
        const ids = Array.isArray(row.saintIds) ? row.saintIds.map(String) : []
        rows.push({
          month,
          type: String(row.type || ''),
          message: String(row.message || ''),
          date: String(row.date || ''),
          ids,
          names: namesFor(ids, byId).join(', '),
        })
      }
      if (rows.length >= QUERY_READ_CAP) return rows
    }
  }
  return rows
}

function readableRow(
  collection: string,
  id: string,
  data: Record<string, unknown>,
  byId: Map<string, string>,
  byPhone: Map<string, string>,
): Record<string, unknown> {
  const row = plainValue({ id, ...data }) as Record<string, unknown>
  const saintId = String(row.saintId || '')
  if (saintId && !row.saintName) row.saintName = byId.get(saintId) || ''
  if (collection === 'availability') {
    row.partnerNames = namesFor(row.partnerPreferences, byId)
    if (Array.isArray(row.dateSpecificPartners)) {
      row.dateSpecificPartners = row.dateSpecificPartners.map(item => {
        const partner = item as Record<string, unknown>
        return { ...partner, partnerName: byId.get(String(partner.partnerId || '')) || '' }
      })
    }
  }
  if (collection === 'requests' && row.requestedBy) {
    row.requestedByName = byId.get(String(row.requestedBy)) || ''
  }
  const phone = normalizePhone(String(row.waId || ''))
  if (phone) row.saintName = byPhone.get(phone) || row.saintName || ''
  if (collection === 'chats' && Array.isArray(data.turns)) {
    const last = data.turns[data.turns.length - 1] as { content?: string } | undefined
    row.lastMessage = String(last?.content || '').slice(0, 200)
    delete row.turns
  }
  return row
}

export async function appFacts(today: string): Promise<string> {
  const saints = await loadSaints()
  const schedules = await firestore().collection('schedules').get()
  const months = schedules.docs.map(doc => doc.id).sort()
  return [
    `Today is ${today} (IST).`,
    `Saints: ${saints.length}. WhatsApp admins: ${saints.filter(saint => saint.isAdmin).length}. Emergency staff: ${saints.filter(saint => saint.isEmergencyDuty).length}.`,
    `Charts saved for: ${months.join(', ') || 'none'}.`,
  ].join(' ')
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
