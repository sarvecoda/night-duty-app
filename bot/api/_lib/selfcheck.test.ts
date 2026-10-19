import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import {
  attendanceSummary,
  canonicalButton,
  checkExchange,
  classifyDuty,
  knownCollection,
  lastDayOfMonth,
  matchByName,
  monthEndKind,
  normalizePhone,
  parseAttendanceButton,
  runQuery,
  scrubDigits,
  shapePeople,
  toolNamesFor,
  WEB_TOOL_NAMES,
} from './pure.js'
import { definitionsFor, definitionsForWeb } from './tools.js'
import { missingWhatsAppEnv } from './metaSetup.js'
import { TEMPLATE_SPECS, templatePayload, verifySignature } from './whatsapp.js'

test('normalizes Indian phone numbers', () => {
  assert.equal(normalizePhone('9876543210'), '919876543210')
  assert.equal(normalizePhone('09876543210'), '919876543210')
  assert.equal(normalizePhone('+91 98765 43210'), '919876543210')
  assert.equal(normalizePhone('919876543210'), '919876543210')
  assert.equal(normalizePhone('12345'), null)
  assert.equal(normalizePhone(''), null)
})

test('month-end steps for 28, 29, 30, and 31 day months', () => {
  assert.equal(lastDayOfMonth('2027-02'), '2027-02-28')
  assert.equal(monthEndKind('2027-02-23'), 'ask')
  assert.equal(monthEndKind('2027-02-25'), 'remind')
  assert.equal(monthEndKind('2027-02-27'), 'remind')
  assert.equal(monthEndKind('2027-02-28'), 'chart')
  assert.equal(monthEndKind('2027-02-22'), null)

  assert.equal(lastDayOfMonth('2028-02'), '2028-02-29')
  assert.equal(monthEndKind('2028-02-24'), 'ask')
  assert.equal(monthEndKind('2028-02-26'), 'remind')
  assert.equal(monthEndKind('2028-02-28'), 'remind')
  assert.equal(monthEndKind('2028-02-29'), 'chart')

  assert.equal(lastDayOfMonth('2026-04'), '2026-04-30')
  assert.equal(monthEndKind('2026-04-25'), 'ask')
  assert.equal(monthEndKind('2026-04-27'), 'remind')
  assert.equal(monthEndKind('2026-04-29'), 'remind')
  assert.equal(monthEndKind('2026-04-30'), 'chart')

  assert.equal(lastDayOfMonth('2026-10'), '2026-10-31')
  assert.equal(monthEndKind('2026-10-26'), 'ask')
  assert.equal(monthEndKind('2026-10-28'), 'remind')
  assert.equal(monthEndKind('2026-10-30'), 'remind')
  assert.equal(monthEndKind('2026-10-31'), 'chart')
})

test('members do not get admin tools or phone numbers', () => {
  const member = toolNamesFor(false)
  const admin = toolNamesFor(true)
  assert.deepEqual(member, [
    'get_my_duties',
    'save_my_availability',
    'confirm_coming',
    'cannot_come',
    'find_person',
    'request_swap',
  ])
  for (const name of ['get_chart', 'get_person', 'who_has_not_replied', 'get_attendance', 'record_attendance', 'ask_to_cover']) {
    assert.equal(member.includes(name), false)
    assert.equal(admin.includes(name), true)
  }
  const people = [{ name: 'Rahul', description: 'Ward A', mobile: '919876543210', duties: ['12 Oct 2026'] }]
  const hidden = shapePeople(people, false)
  assert.equal('mobile' in hidden[0], false)
  assert.equal(JSON.stringify(hidden).includes('9876543210'), false)
  const shown = shapePeople(people, true)
  assert.equal(shown[0].mobile, '919876543210')
  assert.deepEqual(definitionsFor(false).map(tool => tool.function.name), member)
  assert.deepEqual(definitionsFor(true).map(tool => tool.function.name), admin)
  assert.deepEqual(definitionsForWeb().map(tool => tool.function.name), [...WEB_TOOL_NAMES])
  for (const name of ['save_my_availability', 'request_swap', 'record_attendance', 'ask_to_cover', 'cannot_come']) {
    assert.equal(WEB_TOOL_NAMES.includes(name as typeof WEB_TOOL_NAMES[number]), false)
  }
})

test('webhook signature uses the raw body', () => {
  const raw = '{"entry":[]}'
  const secret = 'app-secret'
  const header = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
  assert.equal(verifySignature(raw, header, secret), true)
  assert.equal(verifySignature(raw, header, 'other'), false)
  assert.equal(verifySignature('{"entry":[1]}', header, secret), false)
  assert.equal(verifySignature(raw, undefined, secret), false)
  assert.equal(verifySignature(raw, header, undefined), false)
})

test('swap and cover rules', () => {
  const slots = [
    { date: '2026-11-12', saintIds: ['a', 'p'] },
    { date: '2026-11-19', saintIds: ['b', 'q'] },
  ]
  assert.equal(checkExchange({
    today: '2026-11-01', kind: 'swap', fromId: 'a', toId: 'b', fromDate: '2026-11-12', toDate: '2026-11-19', slots, toDutyCount: 1,
  }).ok, true)
  assert.equal(checkExchange({
    today: '2026-11-13', kind: 'swap', fromId: 'a', toId: 'b', fromDate: '2026-11-12', toDate: '2026-11-19', slots, toDutyCount: 1,
  }).ok, false)
  assert.equal(checkExchange({
    today: '2026-11-01', kind: 'cover', fromId: 'a', toId: 'b', fromDate: '2026-11-12', slots, toDutyCount: 2,
  }).ok, false)
  assert.equal(checkExchange({
    today: '2026-11-01', kind: 'cover', fromId: 'a', toId: 'b', fromDate: '2026-11-12', slots, toDutyCount: 1,
  }).ok, true)
  assert.equal(checkExchange({
    today: '2026-11-01', kind: 'cover', fromId: 'a', toId: 'p', fromDate: '2026-11-12', slots, toDutyCount: 0,
  }).ok, false)
  assert.equal(checkExchange({
    today: '2026-11-01', kind: 'swap', fromId: 'a', toId: 'a', fromDate: '2026-11-12', toDate: '2026-11-19', slots, toDutyCount: 0,
  }).ok, false)
})

test('attendance uses the admin mark, otherwise a No', () => {
  assert.equal(classifyDuty({ saintId: 'a', saintName: 'A', reply: 'yes' }), 'unconfirmed')
  assert.equal(classifyDuty({ saintId: 'a', saintName: 'A', reply: 'no' }), 'absent')
  assert.equal(classifyDuty({ saintId: 'a', saintName: 'A', reply: 'no', adminMark: 'present' }), 'present')
  const summary = attendanceSummary([
    { saintId: 'a', saintName: 'Asha', adminMark: 'present' },
    { saintId: 'a', saintName: 'Asha', adminMark: 'absent' },
    { saintId: 'a', saintName: 'Asha', reply: 'yes' },
  ])
  assert.equal(summary[0].percent, 50)
  assert.equal(summary[0].unconfirmed, 1)
})

test('hides long numbers from member replies', () => {
  assert.equal(scrubDigits('Call 919876543210 tonight'), 'Call [hidden] tonight')
  assert.equal(scrubDigits('Duty on 2026-11-12'), 'Duty on 2026-11-12')
})

test('template button labels map to fixed payloads', () => {
  assert.equal(canonicalButton('Yes', 'Yes'), 'YES')
  assert.equal(canonicalButton('Available all days'), 'AVAILABLE_ALL')
  assert.equal(canonicalButton('COVER_YES', 'Yes'), 'COVER_YES')
  assert.equal(canonicalButton('duty_yes_2026-11-12', 'Yes'), 'duty_yes_2026-11-12')
  assert.equal(TEMPLATE_SPECS.map(spec => spec.name).join(','), [
    'duty_reminder',
    'availability_request',
    'chart_ready',
    'swap_request',
    'cover_request',
    'attendance_check',
    'duty_update',
  ].join(','))
  const reminder = templatePayload(TEMPLATE_SPECS[0])
  assert.equal(reminder.category, 'UTILITY')
  assert.deepEqual(TEMPLATE_SPECS[0].buttons.map(button => button.text), ['Yes', 'No'])
  assert.equal(canonicalButton('Yes'), 'YES')
  assert.equal(missingWhatsAppEnv().includes('WHATSAPP_PHONE_NUMBER_ID'), true)
})

test('reads attendance button ids', () => {
  const parsed = parseAttendanceButton('att_first_2026-11-12_alpha_beta')
  assert.deepEqual(parsed, { kind: 'ATT_FIRST', date: '2026-11-12', firstId: 'alpha', secondId: 'beta' })
  const one = parseAttendanceButton('att_both_2026-11-12_alpha_')
  assert.equal(one?.secondId, '')
  assert.equal(one?.kind, 'ATT_BOTH')
})

function queried(result: ReturnType<typeof runQuery>) {
  if ('error' in result) throw new Error(result.error)
  return result
}

test('query_data filters, groups, and caps rows', () => {
  const rows = [
    { name: 'Hardik', city: 'Delhi', tags: ['lead', 'night'], duties: 2 },
    { name: 'Anand', city: 'Delhi', tags: ['night'], duties: 1 },
    { name: 'Rakesh', city: 'Pune', tags: [], duties: 0 },
  ]
  assert.equal(knownCollection('secrets'), false)
  assert.equal(knownCollection('saints'), true)
  assert.deepEqual(queried(runQuery(rows, { where: [{ field: 'city', op: '==', value: 'delhi' }] })).rows?.map(row => row.name), ['Hardik', 'Anand'])
  assert.equal(queried(runQuery(rows, { where: [{ field: 'city', op: '!=', value: 'Delhi' }] })).rows?.length, 1)
  assert.equal(queried(runQuery(rows, { where: [{ field: 'duties', op: '<', value: 1 }] })).rows?.[0].name, 'Rakesh')
  assert.equal(queried(runQuery(rows, { where: [{ field: 'duties', op: '<=', value: 1 }] })).rows?.length, 2)
  assert.equal(queried(runQuery(rows, { where: [{ field: 'duties', op: '>', value: 1 }] })).rows?.[0].name, 'Hardik')
  assert.equal(queried(runQuery(rows, { where: [{ field: 'duties', op: '>=', value: 2 }] })).rows?.length, 1)
  assert.equal(queried(runQuery(rows, { where: [{ field: 'city', op: 'in', value: ['Pune', 'Goa'] }] })).rows?.[0].name, 'Rakesh')
  assert.equal(queried(runQuery(rows, { where: [{ field: 'name', op: 'contains', value: 'hard' }] })).rows?.[0].name, 'Hardik')
  assert.equal(queried(runQuery(rows, { where: [{ field: 'tags', op: 'contains', value: 'LEAD' }] })).rows?.[0].name, 'Hardik')
  assert.equal(queried(runQuery(rows, { where: [{ field: 'tags', op: 'exists', value: true }] })).rows?.length, 3)
  assert.equal(queried(runQuery(rows, { where: [{ field: 'missing', op: 'exists', value: false }] })).rows?.length, 3)
  assert.deepEqual(queried(runQuery(rows, { groupBy: 'city', desc: true })).groups?.[0], { key: 'Delhi', count: 2 })
  assert.deepEqual(queried(runQuery(rows, { groupBy: 'tags', desc: true })).groups?.[0], { key: 'night', count: 2 })
  assert.equal('error' in runQuery(rows, { where: [{ field: 'city', op: 'like', value: 'D' }] }), true)
  const many = Array.from({ length: 250 }, (_, index) => ({ n: index }))
  const capped = queried(runQuery(many, {}))
  assert.equal(capped.row_count, 'more than 200 (only 200 shown; add a filter or groupBy)')
  assert.equal(capped.rows?.length, 200)
})

test('name matching prefers one exact person', () => {
  const people = [
    { id: '1', name: 'Rahul Sharma' },
    { id: '2', name: 'Rahul Singh' },
  ]
  assert.equal(matchByName(people, 'Rahul').kind, 'many')
  assert.equal(matchByName(people, 'rahul sharma').kind, 'one')
  assert.equal(matchByName(people, 'x').kind, 'none')
})
