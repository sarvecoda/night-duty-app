import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { generateMonthlySchedule } from '../../../frontend/src/services/scheduleGenerator.js'
import type { Availability } from '../../../frontend/src/types/index'
import {
  alertAdmins,
  availabilityForMonth,
  claimJob,
  dutiesOn,
  getChat,
  getSchedule,
  loadSaints,
  purgeExpired,
  saveChat,
  saveGeneratedSchedule,
  waIdFor,
  type BotSaint,
  type Pending,
} from './roster.js'
import { deliver, uploadPdf, type OutButton } from './whatsapp.js'
import {
  monthEndKind,
  nextMonthYear,
  prettyDate,
  weekday,
  within24Hours,
} from './pure.js'

export async function runMorning(today: string, persist: boolean) {
  if (persist && !(await claimJob(today, 'morning'))) return { skipped: true }
  const removed = await purgeExpired()
  await askAttendance(today)
  await remindTonight(today)
  await monthStep(today)
  return { ok: true, removed }
}

export async function runEvening(today: string, persist: boolean) {
  if (persist && !(await claimJob(today, 'evening'))) return { skipped: true }
  await eveningReport(today)
  return { ok: true }
}

async function askAttendance(today: string) {
  const yesterday = shiftDate(today, -1)
  const schedule = await getSchedule(yesterday.slice(0, 7))
  const assignment = schedule?.assignments.find(item => item.date === yesterday)
  const ids = assignment?.saintIds || []
  if (!ids.length) return
  const names = assignment?.saintNames || []
  const saints = (await loadSaints()).filter(saint => saint.isAdmin)
  const buttons = attendanceButtons(yesterday, ids)
  const text = ids.length === 1
    ? `Did ${names[0]} come for night duty on ${prettyDate(yesterday)}? Tap Both if they came, or Neither if they did not.`
    : `Who came for night duty on ${prettyDate(yesterday)}? First: ${names[0] || 'nobody'}. Second: ${names[1] || 'nobody'}.`
  for (const admin of saints) {
    await messageSaint(admin, {
      text,
      buttons,
      templateName: 'attendance_check',
      templateParams: [prettyDate(yesterday), names[0] || 'nobody', names[1] || 'nobody'],
      pending: {
        kind: 'attendance',
        dutyDate: yesterday,
        firstId: ids[0],
        secondId: ids[1] || '',
      },
    })
  }
}

function attendanceButtons(date: string, ids: string[]): OutButton[] {
  const tail = `${date}_${ids[0]}_${ids[1] || ''}`
  if (ids.length === 1) {
    return [
      { id: `att_both_${tail}`, title: 'Came' },
      { id: `att_neither_${tail}`, title: 'Did not' },
    ]
  }
  return [
    { id: `att_both_${tail}`, title: 'Both' },
    { id: `att_first_${tail}`, title: 'Only first' },
    { id: `att_second_${tail}`, title: 'Only second' },
    { id: `att_neither_${tail}`, title: 'Neither' },
  ]
}

async function remindTonight(today: string) {
  const schedule = await getSchedule(today.slice(0, 7))
  const assignment = schedule?.assignments.find(item => item.date === today)
  if (!assignment?.saintIds?.length) return
  const saints = await loadSaints()
  for (let i = 0; i < assignment.saintIds.length; i++) {
    const saint = saints.find(person => person.id === assignment.saintIds[i])
    if (!saint) continue
    const when = prettyDate(today)
    await messageSaint(saint, {
      text: `Hi ${saint.name}, you are on night duty on ${when}. Will you come?`,
      buttons: [
        { id: `duty_yes_${today}`, title: 'Yes' },
        { id: `duty_no_${today}`, title: 'No' },
      ],
      templateName: 'duty_reminder',
      templateParams: [saint.name, when],
      pending: { kind: 'duty_reply', dutyDate: today },
    })
  }
}

async function monthStep(today: string) {
  const kind = monthEndKind(today)
  if (!kind) return
  const monthYear = nextMonthYear(today.slice(0, 7))
  if (kind === 'ask') await askAvailability(monthYear, false)
  if (kind === 'remind') await askAvailability(monthYear, true)
  if (kind === 'chart') await publishChart(monthYear)
}

async function askAvailability(monthYear: string, remind: boolean) {
  const saints = await loadSaints()
  const existing = new Set((await availabilityForMonth(monthYear)).map(row => row.saintId))
  const targets = saints.filter(saint => {
    if (saint.isUnavailableForDuty) return false
    return remind ? !existing.has(saint.id) : true
  })
  const missed: string[] = []
  for (const saint of targets) {
    const sent = await messageSaint(saint, {
      text: `Hi ${saint.name}, please reply with the dates you cannot do night duty in ${monthYear}, or tap the button if every day is fine.`,
      buttons: [{ id: `avail_all_${monthYear}`, title: 'Available all days' }],
      templateName: 'availability_request',
      templateParams: [saint.name, monthYear],
      pending: { kind: 'availability', monthYear },
    })
    if (!sent) missed.push(saint.name)
  }
  const label = remind ? 'Availability reminder' : 'Availability request'
  await alertAdmins(`${label} for ${monthYear} sent to ${targets.length - missed.length} people.${missed.length ? ` Could not message: ${missed.join(', ')}.` : ''}`)
}

async function publishChart(monthYear: string) {
  let schedule = await getSchedule(monthYear)
  if (!schedule) {
    const saints = await loadSaints(true)
    const rows = await availabilityForMonth(monthYear)
    const availabilities = new Map<string, Availability>()
    for (const row of rows) {
      availabilities.set(row.saintId, {
        ...row,
        unavailableDates: row.unavailableDates || [],
        unavailableDays: row.unavailableDays || [],
        availableDates: row.availableDates || [],
        availableDays: row.availableDays || [],
        partnerPreferences: row.partnerPreferences || [],
        dateSpecificPartners: row.dateSpecificPartners || [],
      })
    }
    schedule = generateMonthlySchedule({ saints, availabilities, monthYear })
    await saveGeneratedSchedule(schedule)
  }
  const filename = `night-duty-${monthYear}.pdf`
  const mediaId = await uploadPdf(chartPdf(monthYear, schedule.assignments), filename)
  const saints = await loadSaints(true)
  const missed: string[] = []
  for (const saint of saints) {
    const mine = schedule.assignments
      .filter(assignment => assignment.saintIds?.includes(saint.id))
      .map(assignment => prettyDate(assignment.date))
    const dates = mine.length ? mine.join(', ') : 'none'
    const sent = await messageSaint(saint, {
      text: `Hi ${saint.name}, the night duty chart for ${monthYear} is attached. Your dates: ${dates}.`,
      templateName: 'chart_ready',
      templateParams: [saint.name, monthYear, dates],
      document: { id: mediaId, filename },
    })
    if (!sent) missed.push(saint.name)
  }
  const short = schedule.assignments
    .filter(assignment => assignment.status !== 'filled')
    .map(assignment => prettyDate(assignment.date))
  await alertAdmins(
    `Chart for ${monthYear} sent. Short-staffed days: ${short.join(', ') || 'none'}. Could not message: ${missed.join(', ') || 'none'}.`,
  )
}

async function eveningReport(today: string) {
  const schedule = await getSchedule(today.slice(0, 7))
  const assignment = schedule?.assignments.find(item => item.date === today)
  if (!assignment?.saintIds?.length) {
    await alertAdmins(`Nobody is assigned for tonight, ${prettyDate(today)}.`)
    return
  }
  const duties = await dutiesOn(today, assignment.saintIds, assignment.saintNames || [])
  const silent = duties.filter(duty => !duty.reply).map(duty => duty.saintName)
  const uncovered = duties.filter(duty => duty.reply === 'no').map(duty => duty.saintName)
  await alertAdmins(
    `Tonight ${prettyDate(today)}. No reply yet: ${silent.join(', ') || 'none'}. Said they cannot come: ${uncovered.join(', ') || 'none'}.`,
  )
}

async function messageSaint(saint: BotSaint, opts: {
  text: string
  buttons?: OutButton[]
  templateName: string
  templateParams: string[]
  pending?: Pending
  document?: { id: string; filename: string }
}): Promise<boolean> {
  const to = waIdFor(saint)
  if (!to) return false
  const chat = await getChat(to, saint.id)
  const windowOpen = within24Hours(chat.lastInboundAt)
  try {
    await deliver({
      to,
      windowOpen,
      text: opts.text,
      buttons: opts.buttons,
      templateName: opts.templateName,
      templateParams: opts.templateParams,
      document: opts.document,
    })
    if (!windowOpen && opts.pending) await saveChat(chat, { pending: opts.pending })
    return true
  } catch (error) {
    console.error('send failed', saint.id, error)
    return false
  }
}

export function chartPdf(monthYear: string, assignments: { date: string; saintNames?: string[]; status: string }[]): Buffer {
  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.text(`Night duty chart ${monthYear}`, 14, 18)
  autoTable(doc, {
    startY: 26,
    head: [['Date', 'Day', 'On duty', 'Status']],
    body: assignments.map(assignment => [
      assignment.date,
      weekday(assignment.date),
      assignment.saintNames?.join(', ') || '-',
      assignment.status,
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [79, 70, 229] },
  })
  return Buffer.from(doc.output('arraybuffer'))
}

function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
