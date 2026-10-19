import type { OutButton } from './whatsapp.js'
import type { BotSaint, Pending } from './roster.js'
import {
  alertAdmins,
  availabilityForMonth,
  createRequest,
  dutiesFor,
  dutiesOn,
  getAvailability,
  getSchedule,
  loadSaints,
  personLabel,
  recentMonths,
  saveAvailability,
  saveDuty,
  slotsOf,
} from './roster.js'
import {
  attendanceSummary,
  checkExchange,
  displayName,
  dutyCount,
  matchByName,
  nextMonthYear,
  normalizeWeekday,
  prettyDate,
  shapePeople,
  toolNamesFor,
  weekday,
  type AttendanceInput,
} from './pure.js'

export { toolNamesFor }

export interface Caller {
  saint: BotSaint
  waId: string
  today: string
}

export interface ToolResult {
  direct?: string
  buttons?: OutButton[]
  data?: unknown
  error?: string
  pending?: Pending | null
}

interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  adminOnly?: boolean
}

const dateProp = { type: 'string', description: 'Date as YYYY-MM-DD' }
const stringList = { type: 'array', items: { type: 'string' } }

const TOOLS: ToolDef[] = [
  {
    name: 'get_my_duties',
    description: 'List the caller\'s own duty dates and partner names. Never includes phone numbers.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'save_my_availability',
    description: 'Update the caller\'s availability for a future month that has no chart yet. Send only the changes. availableAll clears restrictions. Dates must be YYYY-MM-DD in that month. Days are weekday names.',
    parameters: {
      type: 'object',
      properties: {
        monthYear: { type: 'string', description: 'YYYY-MM. Defaults to next month.' },
        addUnavailableDates: stringList,
        removeUnavailableDates: stringList,
        addUnavailableDays: stringList,
        removeUnavailableDays: stringList,
        onlyDays: { ...stringList, description: 'If set, these are the only weekdays they can work.' },
        partnerNames: stringList,
        availableAll: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'confirm_coming',
    description: 'Mark that the caller will attend their own duty. Defaults to today if they are on duty today.',
    parameters: { type: 'object', properties: { date: dateProp }, required: [] },
  },
  {
    name: 'cannot_come',
    description: 'Mark that the caller cannot attend their own duty, and tell the admins. Include their reason when they gave one.',
    parameters: {
      type: 'object',
      properties: { date: dateProp, message: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'find_person',
    description: 'Find a member by name. Returns names, descriptions, and duty dates only.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'request_swap',
    description: 'Prepare a swap or a cover request. Ask the caller to confirm before anyone else is messaged. Omit theirDate when the caller wants the other person to cover the caller\'s date.',
    parameters: {
      type: 'object',
      properties: {
        personName: { type: 'string' },
        myDate: dateProp,
        theirDate: dateProp,
      },
      required: ['personName', 'myDate'],
    },
  },
  {
    name: 'get_chart',
    description: 'Admin only. Show who is on duty for a month.',
    adminOnly: true,
    parameters: { type: 'object', properties: { monthYear: { type: 'string' } }, required: [] },
  },
  {
    name: 'get_person',
    description: 'Admin only. Look up a member, including their phone number.',
    adminOnly: true,
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'who_has_not_replied',
    description: 'Admin only. List people who have not sent next month\'s availability, or who have not answered tonight\'s reminder.',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: { which: { type: 'string', enum: ['availability', 'tonight'] } },
      required: ['which'],
    },
  },
  {
    name: 'get_attendance',
    description: 'Admin only. Attendance percentage over the last 1 to 6 months. An admin mark wins. A No with no admin mark counts as absent. Anything else is unconfirmed and left out of the percentage.',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        months: { type: 'number' },
        personName: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'record_attendance',
    description: 'Admin only. Record whether someone attended a duty night.',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        personName: { type: 'string' },
        date: dateProp,
        present: { type: 'boolean' },
      },
      required: ['personName', 'date', 'present'],
    },
  },
  {
    name: 'ask_to_cover',
    description: 'Admin only. Prepare a request asking one person to cover another person\'s date. The admin must confirm before the message is sent.',
    adminOnly: true,
    parameters: {
      type: 'object',
      properties: {
        personName: { type: 'string' },
        date: dateProp,
        replacingName: { type: 'string' },
      },
      required: ['personName', 'date', 'replacingName'],
    },
  },
]

export function definitionsFor(isAdmin: boolean) {
  return TOOLS.filter(tool => isAdmin || !tool.adminOnly).map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

function arg(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? args[key].trim() : ''
}

function argList(args: Record<string, unknown>, key: string): string[] {
  const value = args[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
}

function monthDates(monthYear: string, dates: string[], label: string): string | null {
  const bad = dates.filter(date => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(monthYear))
  return bad.length ? `${label} must be YYYY-MM-DD inside ${monthYear}.` : null
}

async function resolveOne(name: string): Promise<{ ok: true; person: BotSaint } | { ok: false; error: string }> {
  const match = matchByName(await loadSaints(), name)
  if (match.kind === 'none') return { ok: false, error: `Nobody matches "${name}".` }
  if (match.kind === 'many') {
    return { ok: false, error: `Several people match "${name}": ${match.people.map(personLabel).join(', ')}. Ask which one.` }
  }
  return { ok: true, person: match.person }
}

async function ownDutyDate(caller: Caller, requested: string): Promise<{ date: string } | { error: string }> {
  const months = [caller.today.slice(0, 7), nextMonthYear(caller.today.slice(0, 7))]
  const duties = (await dutiesFor(caller.saint.id, months)).filter(duty => duty.date >= caller.today)
  if (requested) {
    if (!duties.some(duty => duty.date === requested)) {
      return { error: `${prettyDate(requested)} is not one of your duty dates.` }
    }
    return { date: requested }
  }
  const todayHit = duties.find(duty => duty.date === caller.today)
  if (todayHit) return { date: todayHit.date }
  if (duties.length === 1) return { date: duties[0].date }
  if (!duties.length) return { error: 'You have no upcoming duty on the chart.' }
  return { error: `Which date? You are on ${duties.map(duty => prettyDate(duty.date)).join(', ')}.` }
}

export async function runTool(caller: Caller, name: string, raw: string): Promise<ToolResult> {
  const allowed = new Set(toolNamesFor(caller.saint.isAdmin === true))
  if (!allowed.has(name)) return { error: 'That action is not available.' }
  let args: Record<string, unknown> = {}
  if (raw) {
    try {
      args = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return { error: 'Bad tool arguments.' }
    }
  }
  try {
    return await dispatch(caller, name, args)
  } catch (error) {
    console.error('tool failed', name, error)
    return { error: 'That could not be saved. Please try again.' }
  }
}

async function dispatch(caller: Caller, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case 'get_my_duties':
      return myDuties(caller)
    case 'save_my_availability':
      return saveMine(caller, args)
    case 'confirm_coming':
      return markComing(caller, arg(args, 'date'), true, '')
    case 'cannot_come':
      return markComing(caller, arg(args, 'date'), false, arg(args, 'message'))
    case 'find_person':
      return findPeople(caller, arg(args, 'name'), false)
    case 'request_swap':
      return draftExchange(caller, {
        kind: arg(args, 'theirDate') ? 'swap' : 'cover',
        personName: arg(args, 'personName'),
        fromId: caller.saint.id,
        fromDate: arg(args, 'myDate'),
        theirDate: arg(args, 'theirDate'),
      })
    case 'get_chart':
      return chartFor(arg(args, 'monthYear') || caller.today.slice(0, 7))
    case 'get_person':
      return findPeople(caller, arg(args, 'name'), true)
    case 'who_has_not_replied':
      return missingReplies(caller, arg(args, 'which') === 'tonight' ? 'tonight' : 'availability')
    case 'get_attendance':
      return attendanceFor(caller, Number(args.months || 1), arg(args, 'personName'))
    case 'record_attendance':
      return recordMark(arg(args, 'personName'), arg(args, 'date'), args.present === true)
    case 'ask_to_cover':
      return draftCoverAsk(caller, arg(args, 'personName'), arg(args, 'date'), arg(args, 'replacingName'))
    default:
      return { error: 'Unknown action.' }
  }
}

async function myDuties(caller: Caller): Promise<ToolResult> {
  const months = [caller.today.slice(0, 7), nextMonthYear(caller.today.slice(0, 7))]
  const duties = await dutiesFor(caller.saint.id, months)
  return {
    data: duties.length
      ? duties.map(duty => ({ date: prettyDate(duty.date), with: duty.partners.join(', ') || 'nobody yet' }))
      : 'No duty dates on the current or next chart.',
  }
}

async function saveMine(caller: Caller, args: Record<string, unknown>): Promise<ToolResult> {
  const monthYear = arg(args, 'monthYear') || nextMonthYear(caller.today.slice(0, 7))
  if (!/^\d{4}-\d{2}$/.test(monthYear)) return { error: 'monthYear must be YYYY-MM.' }
  if (monthYear < caller.today.slice(0, 7)) return { error: 'That month has passed.' }
  if (await getSchedule(monthYear)) {
    return { direct: `The ${monthYear} chart is already made. An admin has to change it from the app.` }
  }
  const existing = await getAvailability(caller.saint.id, monthYear)
  let unavailableDates = [...(existing?.unavailableDates || [])]
  let unavailableDays = [...(existing?.unavailableDays || [])]
  let availableDates = [...(existing?.availableDates || [])]
  let availableDays = [...(existing?.availableDays || [])]
  let partnerPreferences = [...(existing?.partnerPreferences || [])]
  const dateSpecificPartners = [...(existing?.dateSpecificPartners || [])]

  if (args.availableAll === true) {
    unavailableDates = []
    unavailableDays = []
    availableDates = []
    availableDays = []
  }
  const addDates = argList(args, 'addUnavailableDates')
  const removeDates = argList(args, 'removeUnavailableDates')
  const dateError = monthDates(monthYear, [...addDates, ...removeDates], 'Dates')
  if (dateError) return { error: dateError }
  unavailableDates = [...new Set([...unavailableDates, ...addDates])].filter(date => !removeDates.includes(date)).sort()

  const addDays = argList(args, 'addUnavailableDays').map(normalizeWeekday)
  const removeDays = argList(args, 'removeUnavailableDays').map(normalizeWeekday)
  if ([...addDays, ...removeDays].includes(null)) return { error: 'Use full weekday names such as Sunday.' }
  unavailableDays = [...new Set([...unavailableDays, ...(addDays as string[])])].filter(day => !removeDays.includes(day))

  const onlyDays = argList(args, 'onlyDays').map(normalizeWeekday)
  if (onlyDays.includes(null)) return { error: 'Use full weekday names such as Sunday.' }
  if (argList(args, 'onlyDays').length) {
    availableDays = onlyDays as string[]
    unavailableDays = []
  }

  const partnerNames = argList(args, 'partnerNames')
  if (args.partnerNames) {
    const ids: string[] = []
    for (const name of partnerNames) {
      const resolved = await resolveOne(name)
      if (!resolved.ok) return { error: resolved.error }
      if (resolved.person.id === caller.saint.id) return { error: 'You cannot prefer yourself as a partner.' }
      ids.push(resolved.person.id)
    }
    partnerPreferences = ids
  }

  await saveAvailability({
    saintId: caller.saint.id,
    monthYear,
    unavailableDates,
    unavailableDays,
    availableDates,
    availableDays,
    partnerPreferences,
    dateSpecificPartners,
  })
  const off = [
    ...unavailableDates.map(prettyDate),
    ...unavailableDays,
  ]
  const summary = args.availableAll === true
    ? `every day in ${monthYear}`
    : off.length ? `unavailable on ${off.join(', ')}` : `saved for ${monthYear}`
  return { direct: `Saved. I have you ${summary}.` }
}

async function markComing(caller: Caller, requested: string, coming: boolean, message: string): Promise<ToolResult> {
  const resolved = await ownDutyDate(caller, requested)
  if ('error' in resolved) return { error: resolved.error }
  await saveDuty({
    date: resolved.date,
    saintId: caller.saint.id,
    saintName: caller.saint.name,
    reply: coming ? 'yes' : 'no',
    replyMessage: message || undefined,
  })
  const when = prettyDate(resolved.date)
  if (coming) {
    await alertAdmins(`${caller.saint.name} said they will come on ${when}.`)
    return { direct: `Noted. The admins have been told you will come on ${when}.`, pending: null }
  }
  if (!message) {
    await alertAdmins(`${caller.saint.name} said they cannot come on ${when}.`)
    return {
      direct: `Noted for ${when}. Send a short message and I will pass it to the admins.`,
      pending: { kind: 'decline_message', dutyDate: resolved.date },
    }
  }
  await alertAdmins(`${caller.saint.name} cannot come on ${when}. They said: ${message}`)
  return { direct: `The admins have your message for ${when}.`, pending: null }
}

async function findPeople(caller: Caller, name: string, isAdmin: boolean): Promise<ToolResult> {
  const saints = await loadSaints()
  const match = matchByName(saints, name)
  if (match.kind === 'none') return { data: `Nobody matches "${name}".` }
  const people = match.kind === 'one' ? [match.person] : match.people.slice(0, 5)
  const months = [caller.today.slice(0, 7), nextMonthYear(caller.today.slice(0, 7))]
  const rows = []
  for (const person of people) {
    const duties = await dutiesFor(person.id, months)
    rows.push({
      name: person.name,
      description: person.description,
      mobile: person.mobile,
      duties: duties.map(duty => prettyDate(duty.date)),
    })
  }
  return { data: shapePeople(rows, isAdmin) }
}

async function draftExchange(caller: Caller, input: {
  kind: 'swap' | 'cover'
  personName: string
  fromId: string
  fromDate: string
  theirDate?: string
}): Promise<ToolResult> {
  const other = await resolveOne(input.personName)
  if (!other.ok) return { error: other.error }
  const saints = await loadSaints()
  const from = saints.find(saint => saint.id === input.fromId)
  if (!from) return { error: 'Could not find the person giving up the duty.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fromDate)) return { error: 'The duty date must be YYYY-MM-DD.' }
  const months = [...new Set([input.fromDate.slice(0, 7), (input.theirDate || input.fromDate).slice(0, 7)])]
  const slots = (await Promise.all(months.map(getSchedule))).flatMap(slotsOf)
  const monthSlots = slots.filter(slot => slot.date.startsWith(input.fromDate.slice(0, 7)))
  const verdict = checkExchange({
    today: caller.today,
    kind: input.kind,
    fromId: from.id,
    toId: other.person.id,
    fromDate: input.fromDate,
    toDate: input.theirDate,
    slots,
    toDutyCount: dutyCount(monthSlots, other.person.id),
  })
  if (!verdict.ok) return { error: verdict.reason }
  const request = await createRequest({
    kind: input.kind,
    requestedBy: caller.saint.id,
    fromSaintId: from.id,
    fromName: from.name,
    toSaintId: other.person.id,
    toName: other.person.name,
    fromDate: input.fromDate,
    toDate: input.kind === 'swap' ? input.theirDate : undefined,
  })
  const who = personLabel(other.person)
  const text = input.kind === 'swap'
    ? `${who}. You give ${prettyDate(input.fromDate)} and take ${prettyDate(input.theirDate || '')}. Send this request?`
    : `${who} would be asked to cover ${prettyDate(input.fromDate)} for ${from.name}. Send this request?`
  return {
    direct: text,
    buttons: [
      { id: `send_${request.id}`, title: 'Send' },
      { id: `cancel_${request.id}`, title: 'Cancel' },
    ],
  }
}

async function draftCoverAsk(caller: Caller, personName: string, date: string, replacingName: string): Promise<ToolResult> {
  const replacing = await resolveOne(replacingName)
  if (!replacing.ok) return { error: replacing.error }
  return draftExchange(caller, {
    kind: 'cover',
    personName,
    fromId: replacing.person.id,
    fromDate: date,
  })
}

async function chartFor(monthYear: string): Promise<ToolResult> {
  const schedule = await getSchedule(monthYear)
  if (!schedule) return { data: `No chart for ${monthYear}.` }
  return {
    data: schedule.assignments.map(assignment => ({
      date: `${weekday(assignment.date)} ${prettyDate(assignment.date)}`,
      people: assignment.saintNames?.join(', ') || 'nobody',
      status: assignment.status,
    })),
  }
}

async function missingReplies(caller: Caller, which: 'availability' | 'tonight'): Promise<ToolResult> {
  const saints = await loadSaints()
  if (which === 'tonight') {
    const schedule = await getSchedule(caller.today.slice(0, 7))
    const today = schedule?.assignments.find(assignment => assignment.date === caller.today)
    if (!today?.saintIds?.length) return { data: 'Nobody is assigned tonight.' }
    const duties = await dutiesOn(caller.today, today.saintIds, today.saintNames || [])
    const quiet = duties.filter(duty => !duty.reply).map(duty => duty.saintName)
    return { data: quiet.length ? quiet : 'Everyone assigned tonight has replied.' }
  }
  const monthYear = nextMonthYear(caller.today.slice(0, 7))
  const rows = await availabilityForMonth(monthYear)
  const replied = new Set(rows.map(row => row.saintId))
  const names = saints
    .filter(saint => !saint.isUnavailableForDuty && !replied.has(saint.id))
    .map(personLabel)
  return { data: names.length ? { month: monthYear, waiting: names } : `Everyone has replied for ${monthYear}.` }
}

async function attendanceFor(caller: Caller, months: number, personName: string): Promise<ToolResult> {
  const count = Math.min(6, Math.max(1, Math.round(months) || 1))
  const monthList = recentMonths(caller.today, count)
  const rows: AttendanceInput[] = []
  for (const monthYear of monthList) {
    const schedule = await getSchedule(monthYear)
    for (const assignment of schedule?.assignments || []) {
      if (assignment.date > caller.today) continue
      const duties = await dutiesOn(assignment.date, assignment.saintIds || [], assignment.saintNames || [])
      rows.push(...duties.map(duty => ({
        saintId: duty.saintId,
        saintName: duty.saintName,
        adminMark: duty.adminMark,
        reply: duty.reply,
      })))
    }
  }
  let summary = attendanceSummary(rows)
  if (personName) {
    const match = matchByName(summary.map(row => ({ ...row, id: row.saintId })), personName)
    if (match.kind === 'none') return { data: `Nobody matches "${personName}".` }
    if (match.kind === 'many') return { error: `Several people match "${personName}": ${match.people.map(person => person.name).join(', ')}.` }
    summary = summary.filter(row => row.saintId === match.person.saintId)
  }
  return {
    data: summary.map(row => ({
      name: row.name,
      present: row.present,
      absent: row.absent,
      unconfirmed: row.unconfirmed,
      percent: row.percent === null ? 'n/a' : `${row.percent}%`,
    })),
  }
}

async function recordMark(personName: string, date: string, present: boolean): Promise<ToolResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'The date must be YYYY-MM-DD.' }
  const resolved = await resolveOne(personName)
  if (!resolved.ok) return { error: resolved.error }
  await saveDuty({
    date,
    saintId: resolved.person.id,
    saintName: resolved.person.name,
    adminMark: present ? 'present' : 'absent',
  })
  return { direct: `${displayName(resolved.person)} is marked ${present ? 'present' : 'absent'} on ${prettyDate(date)}.` }
}
