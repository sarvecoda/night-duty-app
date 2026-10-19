import { readFileSync } from 'node:fs'
import { connectWhatsApp } from '../api/_lib/metaSetup.ts'

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue
  const index = line.indexOf('=')
  let value = line.slice(index + 1)
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\n/g, '\n')
  process.env[line.slice(0, index)] ||= value
}

connectWhatsApp()
  .then(notes => {
    for (const note of notes) console.log(note)
    console.log('WhatsApp is connected. Add the same three Meta values in Vercel, then redeploy the bot.')
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
