import { passwordHash, passwordLengthOkay } from './auth.js'

const chunks: Buffer[] = []
let size = 0
try {
  if (process.stdin.isTTY) throw new Error('Supply a password on standard input. See the runbook for the hidden prompt.')
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > 258) throw new Error('Use a password of 12 to 256 bytes.')
    chunks.push(chunk)
  }
  const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
  if (!passwordLengthOkay(password)) throw new Error('Use a password of 12 to 256 bytes.')
  console.log(await passwordHash(password))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Password hashing failed.')
  process.exitCode = 1
}
