/** Date, phone, and roster rules with no network or database access. */

export const MEMBER_TOOL_NAMES = [
  'get_my_duties',
  'save_my_availability',
  'confirm_coming',
  'cannot_come',
  'find_person',
  'request_swap',
] as const

export const ADMIN_TOOL_NAMES = [
  ...MEMBER_TOOL_NAMES,
  'get_chart',
  'get_person',
  'who_has_not_replied',
  'get_attendance',
  'record_attendance',
  'ask_to_cover',
] as const

export function toolNamesFor(isAdmin: boolean): string[] {
  return isAdmin ? [...ADMIN_TOOL_NAMES] : [...MEMBER_TOOL_NAMES]
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function istDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function diffDays(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z')
  const b = Date.parse(to + 'T00:00:00Z')
  return Math.round((b - a) / 86400000)
}

export function lastDayOfMonth(monthYear: string): string {
  const [year, month] = monthYear.split('-').map(Number)
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${monthYear}-${String(day).padStart(2, '0')}`
}

export function nextMonthYear(monthYear: string): string {
  const [year, month] = monthYear.split('-').map(Number)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`
}

export function addMonths(monthYear: string, count: number): string {
  let cursor = monthYear
  if (count >= 0) {
    for (let i = 0; i < count; i++) cursor = nextMonthYear(cursor)
    return cursor
  }
  const [year, month] = monthYear.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + count, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** What the morning job should do for the month that is about to end. */
export function monthEndKind(today: string): 'ask' | 'remind' | 'chart' | null {
  const last = lastDayOfMonth(today.slice(0, 7))
  const daysBefore = diffDays(today, last)
  if (daysBefore === 5) return 'ask'
  if (daysBefore === 3 || daysBefore === 1) return 'remind'
  if (daysBefore === 0) return 'chart'
  return null
}

export function prettyDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

export function weekday(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  ]
}

export function normalizeWeekday(value: string): string | null {
  const key = value.trim().toLowerCase()
  const hit = WEEKDAYS.find(day => day === key || day.startsWith(key.slice(0, 3)))
  return key.length >= 3 ? hit || null : null
}

/** Indian mobiles become 91XXXXXXXXXX. Other numbers keep their digits. */
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`
  if (digits.length === 12 && digits.startsWith('91')) return digits
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(1)
  if (digits.length >= 10 && digits.length <= 15) return digits
  return null
}

export function flatten(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

export function scrubDigits(text: string): string {
  return text.replace(/\d{10,}/g, '[hidden]')
}

export function displayName(person: { name: string; description?: string }): string {
  return person.description ? `${person.name} (${person.description})` : person.name
}

export interface NamedPerson {
  id: string
  name: string
  description?: string
  mobile?: string
}

export function matchByName<T extends NamedPerson>(people: T[], query: string):
  | { kind: 'none' }
  | { kind: 'one'; person: T }
  | { kind: 'many'; people: T[] } {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return { kind: 'none' }
  const exact = people.filter(person => person.name.toLowerCase() === q)
  if (exact.length === 1) return { kind: 'one', person: exact[0] }
  if (exact.length > 1) return { kind: 'many', people: exact }
  const partial = people.filter(person => {
    const name = person.name.toLowerCase()
    const label = displayName(person).toLowerCase()
    return name.includes(q) || q.includes(name) || label.includes(q)
  })
  if (partial.length === 1) return { kind: 'one', person: partial[0] }
  if (partial.length > 1) return { kind: 'many', people: partial }
  return { kind: 'none' }
}

export function shapePeople(
  people: { name: string; description?: string; mobile?: string; duties?: string[] }[],
  isAdmin: boolean,
) {
  return people.map(person => {
    const row: Record<string, unknown> = {
      name: displayName(person),
      duties: person.duties || [],
    }
    if (isAdmin) row.mobile = person.mobile || ''
    return row
  })
}

export interface DutySlot {
  date: string
  saintIds: string[]
}

export function checkExchange(input: {
  today: string
  kind: 'swap' | 'cover'
  fromId: string
  toId: string
  fromDate: string
  toDate?: string
  slots: DutySlot[]
  toDutyCount: number
}): { ok: true } | { ok: false; reason: string } {
  const { today, kind, fromId, toId, fromDate, toDate, slots, toDutyCount } = input
  if (fromId === toId) return { ok: false, reason: 'A person cannot swap with themselves.' }
  if (fromDate < today) return { ok: false, reason: 'That duty date has already passed.' }
  const fromSlot = slots.find(slot => slot.date === fromDate)
  if (!fromSlot) return { ok: false, reason: 'That date is not on the chart.' }
  if (!fromSlot.saintIds.includes(fromId)) {
    return { ok: false, reason: 'The person giving up the duty is not assigned that day.' }
  }
  if (kind === 'cover') {
    if (fromSlot.saintIds.includes(toId)) {
      return { ok: false, reason: 'That person is already on duty that day.' }
    }
    if (toDutyCount >= 2) {
      return { ok: false, reason: 'That person already has 2 duties this month.' }
    }
    return { ok: true }
  }
  if (!toDate) return { ok: false, reason: 'A swap needs both dates.' }
  if (toDate < today) return { ok: false, reason: 'The other duty date has already passed.' }
  if (toDate === fromDate) return { ok: false, reason: 'Both dates are the same day.' }
  const toSlot = slots.find(slot => slot.date === toDate)
  if (!toSlot) return { ok: false, reason: 'The other date is not on the chart.' }
  if (!toSlot.saintIds.includes(toId)) {
    return { ok: false, reason: 'The other person is not assigned on that date.' }
  }
  if (fromSlot.saintIds.includes(toId) || toSlot.saintIds.includes(fromId)) {
    return { ok: false, reason: 'Those two people are already on duty together.' }
  }
  return { ok: true }
}

export interface AttendanceInput {
  saintId: string
  saintName: string
  adminMark?: 'present' | 'absent' | null
  reply?: 'yes' | 'no' | null
}

export function classifyDuty(row: AttendanceInput): 'present' | 'absent' | 'unconfirmed' {
  if (row.adminMark === 'present' || row.adminMark === 'absent') return row.adminMark
  if (row.reply === 'no') return 'absent'
  return 'unconfirmed'
}

export function attendanceSummary(rows: AttendanceInput[]) {
  const grouped = new Map<string, { name: string; present: number; absent: number; unconfirmed: number }>()
  for (const row of rows) {
    const current = grouped.get(row.saintId) || { name: row.saintName, present: 0, absent: 0, unconfirmed: 0 }
    current[classifyDuty(row)] += 1
    grouped.set(row.saintId, current)
  }
  return [...grouped.entries()].map(([saintId, stats]) => {
    const decided = stats.present + stats.absent
    return {
      saintId,
      name: stats.name,
      present: stats.present,
      absent: stats.absent,
      unconfirmed: stats.unconfirmed,
      percent: decided === 0 ? null : Math.round((stats.present / decided) * 100),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

const BUTTON_ALIASES: Record<string, string> = {
  yes: 'YES',
  no: 'NO',
  'available all days': 'AVAILABLE_ALL',
  accept: 'ACCEPT',
  decline: 'DECLINE',
  'cover yes': 'COVER_YES',
  'cover no': 'COVER_NO',
  both: 'ATT_BOTH',
  'only first': 'ATT_FIRST',
  'only second': 'ATT_SECOND',
  neither: 'ATT_NEITHER',
}

const KNOWN_PAYLOADS = new Set([
  'YES', 'NO', 'AVAILABLE_ALL', 'ACCEPT', 'DECLINE', 'COVER_YES', 'COVER_NO',
  'ATT_BOTH', 'ATT_FIRST', 'ATT_SECOND', 'ATT_NEITHER',
])

/** Template buttons come back as fixed words. Session buttons already carry an id. */
export function canonicalButton(id: string, title = ''): string {
  if (KNOWN_PAYLOADS.has(id) || /^(send|cancel|duty_yes|duty_no|avail_all|accept|decline|cover_yes|cover_no|att)_/.test(id)) {
    return id
  }
  return BUTTON_ALIASES[id.trim().toLowerCase()] || BUTTON_ALIASES[title.trim().toLowerCase()] || id
}

export function parseAttendanceButton(id: string): { kind: string; date: string; firstId: string; secondId: string } | null {
  const match = id.match(/^att_(both|first|second|neither)_(\d{4}-\d{2}-\d{2})_([^_]+)_?(.*)$/)
  if (!match) return null
  const kind = {
    both: 'ATT_BOTH',
    first: 'ATT_FIRST',
    second: 'ATT_SECOND',
    neither: 'ATT_NEITHER',
  }[match[1]] || 'ATT_NEITHER'
  return { kind, date: match[2], firstId: match[3], secondId: match[4] || '' }
}

export function within24Hours(lastInboundAt: string | undefined, now = Date.now()): boolean {
  if (!lastInboundAt) return false
  const then = Date.parse(lastInboundAt)
  if (Number.isNaN(then)) return false
  return now - then < 24 * 60 * 60 * 1000
}

export function dutyCount(slots: DutySlot[], saintId: string): number {
  return slots.filter(slot => slot.saintIds.includes(saintId)).length
}

export function replaceSaintOnDate<T extends { date: string; saintIds: string[]; saintNames: string[]; status: string; manuallyEdited: boolean }>(
  assignments: T[],
  date: string,
  fromId: string,
  toId: string,
  toName: string,
): T[] {
  return assignments.map(assignment => {
    if (assignment.date !== date) return assignment
    const index = assignment.saintIds.indexOf(fromId)
    if (index < 0) return assignment
    const saintIds = assignment.saintIds.slice()
    const saintNames = assignment.saintNames.slice()
    saintIds[index] = toId
    saintNames[index] = toName
    const status = saintIds.length >= 2 ? 'filled' : saintIds.length === 1 ? 'partial' : 'unfilled'
    return { ...assignment, saintIds, saintNames, status, manuallyEdited: true }
  })
}
