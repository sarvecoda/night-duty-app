import { answer } from './agent.ts'
import { canonicalButton, istDate, parseAttendanceButton, prettyDate, within24Hours } from './pure.ts'
import {
  alertAdmins,
  commitExchange,
  getAvailability,
  getChat,
  getRequest,
  getSchedule,
  loadSaints,
  noteInbound,
  personLabel,
  saveAvailability,
  saveChat,
  saveDuty,
  setRequestStatus,
  transitionRequest,
  waIdFor,
  type BotSaint,
  type ChatDoc,
  type Pending,
} from './roster.ts'
import { deliver, type Inbound, type OutButton } from './whatsapp.ts'

const AI_CAP = 30

export async function handleInbound(message: Inbound, saint: BotSaint): Promise<void> {
  const waId = waIdFor(saint)
  if (!waId) return
  const chat = await noteInbound(waId, saint.id)
  const today = istDate()

  if (message.type !== 'text') {
    await say(saint, chat, 'Please type your message.')
    return
  }

  if (message.buttonId) {
    await handleButton(saint, chat, canonicalButton(message.buttonId, message.buttonTitle || message.text), message.text, today)
    return
  }

  if (chat.pending?.kind === 'decline_message' && chat.pending.dutyDate && message.text) {
    await forwardDecline(saint, chat, chat.pending.dutyDate, message.text)
    return
  }

  const aiCount = chat.aiDay === today ? chat.aiCount || 0 : 0
  if (aiCount >= AI_CAP) {
    await say(saint, chat, 'You have reached today\'s message limit. Please try again tomorrow.', message.text)
    return
  }
  const result = await answer({ saint, waId, today }, message.text, chat.turns)
  await saveChat(chat, {
    turns: [...chat.turns, { role: 'user', content: message.text }, { role: 'assistant', content: result.text }],
    pending: result.pending === undefined ? chat.pending : result.pending,
    aiDay: today,
    aiCount: result.counted === false ? aiCount : aiCount + 1,
  })
  await deliver({ to: waId, windowOpen: true, text: result.text, buttons: result.buttons })
}

async function handleButton(saint: BotSaint, chat: ChatDoc, id: string, title: string, today: string): Promise<void> {
  if (id.startsWith('send_')) return sendDraft(saint, chat, id.slice(5), title)
  if (id.startsWith('cancel_')) return cancelDraft(saint, chat, id.slice(7), title)
  if (id.startsWith('duty_yes_')) return dutyReply(saint, chat, id.slice(9), true, title)
  if (id.startsWith('duty_no_')) return dutyReply(saint, chat, id.slice(8), false, title)
  if (id.startsWith('avail_all_')) return availableAll(saint, chat, id.slice(10), title)
  if (id.startsWith('accept_')) return respondRequest(saint, chat, id.slice(7), true, title, today)
  if (id.startsWith('decline_')) return respondRequest(saint, chat, id.slice(8), false, title, today)
  if (id.startsWith('cover_yes_')) return respondRequest(saint, chat, id.slice(10), true, title, today)
  if (id.startsWith('cover_no_')) return respondRequest(saint, chat, id.slice(9), false, title, today)
  if (id.startsWith('att_')) return attendanceFromId(saint, chat, id, title)

  const pending = chat.pending
  const yes = id === 'YES' || id === 'ACCEPT' || id === 'COVER_YES'
  const no = id === 'NO' || id === 'DECLINE' || id === 'COVER_NO'
  if (pending?.kind === 'duty_reply' && pending.dutyDate && (id === 'YES' || id === 'NO')) {
    return dutyReply(saint, chat, pending.dutyDate, id === 'YES', title)
  }
  if (pending?.kind === 'availability' && pending.monthYear && (id === 'AVAILABLE_ALL' || id === 'YES')) {
    return availableAll(saint, chat, pending.monthYear, title)
  }
  if (pending?.kind === 'request_reply' && pending.requestId && (yes || no)) {
    return respondRequest(saint, chat, pending.requestId, yes, title, today)
  }
  if (id.startsWith('ATT_') && pending?.kind === 'attendance' && pending.dutyDate && pending.firstId) {
    return applyAttendance(saint, chat, pending.dutyDate, pending.firstId, pending.secondId || '', id, title)
  }
  await say(saint, chat, 'That button has expired. Please send the message again.', title)
}

async function dutyReply(saint: BotSaint, chat: ChatDoc, date: string, coming: boolean, title: string): Promise<void> {
  await saveDuty({
    date,
    saintId: saint.id,
    saintName: saint.name,
    reply: coming ? 'yes' : 'no',
  })
  const when = prettyDate(date)
  if (coming) {
    await alertAdmins(`${saint.name} said they will come on ${when}.`)
    await say(saint, chat, `Noted. The admins have been told you will come on ${when}.`, title, null)
    return
  }
  await alertAdmins(`${saint.name} said they cannot come on ${when}.`)
  await say(saint, chat, `Noted for ${when}. Send a short message and I will pass it to the admins.`, title, {
    kind: 'decline_message',
    dutyDate: date,
  })
}

async function forwardDecline(saint: BotSaint, chat: ChatDoc, date: string, text: string): Promise<void> {
  await saveDuty({
    date,
    saintId: saint.id,
    saintName: saint.name,
    reply: 'no',
    replyMessage: text,
  })
  await alertAdmins(`${saint.name} cannot come on ${prettyDate(date)}. They said: ${text}`)
  await say(saint, chat, 'The admins have your message.', text, null)
}

async function availableAll(saint: BotSaint, chat: ChatDoc, monthYear: string, title: string): Promise<void> {
  if (await getSchedule(monthYear)) {
    await say(saint, chat, `The ${monthYear} chart is already made, so I left your availability as it is.`, title, null)
    return
  }
  const existing = await getAvailability(saint.id, monthYear)
  await saveAvailability({
    saintId: saint.id,
    monthYear,
    unavailableDates: [],
    unavailableDays: [],
    availableDates: [],
    availableDays: [],
    partnerPreferences: existing?.partnerPreferences || [],
    dateSpecificPartners: existing?.dateSpecificPartners || [],
  })
  await say(saint, chat, `Saved. I have you available every day in ${monthYear}.`, title, null)
}

async function sendDraft(saint: BotSaint, chat: ChatDoc, requestId: string, title: string): Promise<void> {
  const request = await getRequest(requestId)
  if (!request || request.status !== 'draft') {
    await say(saint, chat, 'That request is no longer open.', title)
    return
  }
  if (request.requestedBy !== saint.id) {
    await say(saint, chat, 'Only the person who started that request can send it.', title)
    return
  }
  const saints = await loadSaints()
  const target = saints.find(person => person.id === request.toSaintId)
  const to = target && waIdFor(target)
  if (!target || !to) {
    await setRequestStatus(requestId, 'failed')
    await say(saint, chat, 'I could not message that person because their number is missing.', title, null)
    return
  }
  if (!(await transitionRequest(requestId, 'draft', 'waiting'))) {
    await say(saint, chat, 'That request is no longer open.', title)
    return
  }
  const targetChat = await getChat(to, target.id)
  const open = within24Hours(targetChat.lastInboundAt)
  const when = prettyDate(request.fromDate)
  try {
    if (request.kind === 'swap') {
      await deliver({
        to,
        windowOpen: open,
        text: `Hi ${target.name}, ${request.fromName} wants to swap. They give ${when} and would take ${prettyDate(request.toDate || '')}.`,
        buttons: [
          { id: `accept_${request.id}`, title: 'Accept' },
          { id: `decline_${request.id}`, title: 'Decline' },
        ],
        templateName: 'swap_request',
        templateParams: [target.name, request.fromName, when, prettyDate(request.toDate || '')],
      })
    } else {
      await deliver({
        to,
        windowOpen: open,
        text: `Hi ${target.name}, can you cover night duty on ${when} for ${request.fromName}?`,
        buttons: [
          { id: `cover_yes_${request.id}`, title: 'Yes' },
          { id: `cover_no_${request.id}`, title: 'No' },
        ],
        templateName: 'cover_request',
        templateParams: [target.name, when, request.fromName],
      })
    }
  } catch (error) {
    console.error('request send failed', requestId, error)
    await setRequestStatus(requestId, 'draft')
    await say(saint, chat, 'I could not send that. Please tap Send again.', title)
    return
  }
  if (!open) {
    await saveChat(targetChat, {
      pending: { kind: 'request_reply', requestId: request.id, requestKind: request.kind },
    })
  }
  await say(saint, chat, `Sent to ${personLabel(target)}.`, title, null)
}

async function cancelDraft(saint: BotSaint, chat: ChatDoc, requestId: string, title: string): Promise<void> {
  const request = await getRequest(requestId)
  if (!request || request.requestedBy !== saint.id) {
    await say(saint, chat, 'That request is no longer open.', title)
    return
  }
  if (request.status === 'draft') await setRequestStatus(requestId, 'cancelled')
  await say(saint, chat, 'Cancelled. Nobody was messaged.', title, null)
}

async function respondRequest(saint: BotSaint, chat: ChatDoc, requestId: string, accept: boolean, title: string, today: string): Promise<void> {
  const request = await getRequest(requestId)
  if (!request || request.status !== 'waiting') {
    await say(saint, chat, 'That request is no longer open.', title, null)
    return
  }
  if (saint.id !== request.toSaintId) {
    await say(saint, chat, 'That request was sent to someone else.', title)
    return
  }
  const saints = await loadSaints()
  const from = saints.find(person => person.id === request.fromSaintId)
  if (!accept) {
    await setRequestStatus(requestId, 'declined')
    await alertAdmins(`${saint.name} declined the ${request.kind} request from ${request.fromName} for ${prettyDate(request.fromDate)}.`)
    if (from) await tell(from, `${saint.name} cannot take ${prettyDate(request.fromDate)}.`)
    await say(saint, chat, 'Declined. The admins have been told.', title, null)
    return
  }
  const result = await commitExchange(request, today)
  if (!result.ok) {
    if (result.reason !== 'That request is no longer open.') {
      await transitionRequest(requestId, 'waiting', 'failed')
    }
    await say(saint, chat, `I could not change the chart. ${result.reason}`, title, null)
    if (from) await tell(from, `The swap could not be saved. ${result.reason}`)
    return
  }
  const summary = request.kind === 'swap'
    ? `${request.fromName} and ${request.toName} swapped ${prettyDate(request.fromDate)} and ${prettyDate(request.toDate || '')}.`
    : `${request.toName} will cover ${prettyDate(request.fromDate)} for ${request.fromName}.`
  await alertAdmins(summary)
  if (from && from.id !== saint.id) await tell(from, summary)
  await say(saint, chat, `Confirmed. ${summary}`, title, null)
}

async function attendanceFromId(saint: BotSaint, chat: ChatDoc, id: string, title: string): Promise<void> {
  const parsed = parseAttendanceButton(id)
  if (!parsed) {
    await say(saint, chat, 'That attendance reply could not be read.', title)
    return
  }
  await applyAttendance(saint, chat, parsed.date, parsed.firstId, parsed.secondId, parsed.kind, title)
}

async function applyAttendance(
  saint: BotSaint,
  chat: ChatDoc,
  date: string,
  firstId: string,
  secondId: string,
  kind: string,
  title: string,
): Promise<void> {
  if (!saint.isAdmin) {
    await say(saint, chat, 'Only an admin can confirm who came.', title)
    return
  }
  const marks = marksFor(kind, firstId, secondId)
  const saints = await loadSaints()
  for (const [saintId, present] of marks) {
    const person = saints.find(item => item.id === saintId)
    await saveDuty({
      date,
      saintId,
      saintName: person?.name || saintId,
      adminMark: present ? 'present' : 'absent',
    })
  }
  await say(saint, chat, `Saved attendance for ${prettyDate(date)}.`, title, null)
}

function marksFor(kind: string, firstId: string, secondId: string): [string, boolean][] {
  if (kind === 'ATT_BOTH') return [[firstId, true], [secondId, true]].filter(row => row[0]) as [string, boolean][]
  if (kind === 'ATT_FIRST') return [[firstId, true], [secondId, false]].filter(row => row[0]) as [string, boolean][]
  if (kind === 'ATT_SECOND') return [[firstId, false], [secondId, true]].filter(row => row[0]) as [string, boolean][]
  return [[firstId, false], [secondId, false]].filter(row => row[0]) as [string, boolean][]
}

async function tell(saint: BotSaint, text: string): Promise<void> {
  const to = waIdFor(saint)
  if (!to) return
  const chat = await getChat(to, saint.id)
  try {
    await deliver({
      to,
      windowOpen: within24Hours(chat.lastInboundAt),
      text,
      templateName: 'duty_update',
      templateParams: [text],
    })
  } catch (error) {
    console.error('reply failed', saint.id, error)
  }
}

async function say(
  saint: BotSaint,
  chat: ChatDoc,
  text: string,
  userText?: string,
  pending?: Pending | null,
  buttons?: OutButton[],
): Promise<void> {
  const turns = userText
    ? [...chat.turns, { role: 'user' as const, content: userText }, { role: 'assistant' as const, content: text }]
    : [...chat.turns, { role: 'assistant' as const, content: text }]
  await saveChat(chat, {
    turns,
    pending: pending === undefined ? chat.pending : pending,
  })
  const to = waIdFor(saint)
  if (!to) return
  await deliver({ to, windowOpen: true, text, buttons })
}
