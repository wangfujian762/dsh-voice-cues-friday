/**
 * Unit tests for dsh-voice-cues. They never play audio: the player and the
 * spawn function are injected, so the same suite runs on macOS, Windows and
 * Linux CI unchanged.
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import {
  apply,
  createHandler,
  createPlayer,
  cuePaths,
  DEFAULTS,
  isSubagentSession,
  normalizeConfig,
  spawnSpecs,
} from '../index.js'

const MP3 = '/tmp/cues/done.mp3'
const WAV = '/tmp/cues/done.wav'
const FILES = { mp3: MP3, wav: WAV }

/** A player that records cues instead of speaking them. */
function recordingPlayer() {
  const played = []
  return {
    played,
    play(kind) {
      played.push(kind)
    },
    stop() {},
  }
}

/** A spawn double that records invocations and hands back an inert child. */
function recordingSpawn(record) {
  return (command, args, options) => {
    const child = new EventEmitter()
    child.kill = () => {}
    child.unref = () => {}
    record.push({ command, args, options, child })
    return child
  }
}

test('defaults are on, quiet for subagents, and keep the shipped files', () => {
  const config = normalizeConfig(undefined)
  assert.equal(config.enabled, true)
  assert.equal(config.onTurnEnd, true)
  assert.equal(config.onApproval, true)
  assert.equal(config.onQuestion, true)
  assert.deepEqual(config.turnEndReasons, ['completed'])
  assert.equal(config.includeSubagents, false)
  assert.equal(config.volume, 1)
  assert.equal(config.variant, 'friday-dongbei')
  assert.deepEqual(config.audio, { done: '', approval: '', question: '' })
  assert.equal(DEFAULTS.minIntervalMs, 600)
})

test('volume and interval are clamped to sane ranges', () => {
  assert.equal(normalizeConfig({ volume: 99 }).volume, 4)
  assert.equal(normalizeConfig({ volume: -3 }).volume, 0)
  assert.equal(normalizeConfig({ minIntervalMs: -1 }).minIntervalMs, 0)
  assert.equal(normalizeConfig({ volume: Number.NaN }).volume, 1)
})

test('false flags stay false instead of being replaced by defaults', () => {
  const config = normalizeConfig({ onTurnEnd: false, includeSubagents: true })
  assert.equal(config.onTurnEnd, false)
  assert.equal(config.onApproval, true)
  assert.equal(config.includeSubagents, true)
})

test('cue files default to the package pair and honour an override', () => {
  const defaults = cuePaths('done', normalizeConfig())
  assert.match(defaults.mp3, /audio[\\/]friday-dongbei[\\/]done\.mp3$/)
  assert.match(defaults.wav, /audio[\\/]friday-dongbei[\\/]done\.wav$/)

  const overridden = cuePaths('approval', normalizeConfig({ audio: { approval: '/custom/line.mp3' } }))
  assert.equal(overridden.mp3, '/custom/line.mp3')
  assert.equal(overridden.wav, '/custom/line.mp3')
})

test('the Friday variant keeps its own folder and an override still wins', () => {
  const friday = cuePaths('done', normalizeConfig({ variant: 'friday' }))
  assert.match(friday.mp3, /audio[\\/]friday[\\/]done\.mp3$/)
  assert.match(friday.wav, /audio[\\/]friday[\\/]done\.wav$/)

  const overridden = cuePaths('done', normalizeConfig({ variant: 'friday', audio: { done: '/x.mp3' } }))
  assert.equal(overridden.mp3, '/x.mp3')
})

test('an unknown variant falls back to the 东北话 pack', () => {
  const paths = cuePaths('done', normalizeConfig({ variant: 'nope' }))
  assert.match(paths.mp3, /audio[\\/]friday-dongbei[\\/]done\.mp3$/)
})

test('the 小鲸鱼 packs are reachable too', () => {
  const mandarin = cuePaths('done', normalizeConfig({ variant: 'personal' }))
  assert.match(mandarin.mp3, /audio[\\/]personal[\\/]done\.mp3$/)
  const dongbei = cuePaths('done', normalizeConfig({ variant: 'personal-dongbei' }))
  assert.match(dongbei.mp3, /audio[\\/]personal-dongbei[\\/]done\.mp3$/)
})

test('the generic 东北话 set is reachable through variant: dongbei', () => {
  const paths = cuePaths('done', normalizeConfig({ variant: 'dongbei' }))
  assert.match(paths.mp3, /audio[\\/]dongbei[\\/]done\.mp3$/)
  assert.doesNotMatch(paths.mp3, /audio[\\/]friday[\\/]/)
})

test('the Mandarin Friday pack stays available through variant: friday', () => {
  const paths = cuePaths('done', normalizeConfig({ variant: 'friday' }))
  assert.match(paths.mp3, /audio[\\/]friday[\\/]done\.mp3$/)
  assert.doesNotMatch(paths.mp3, /dongbei/)
})

test('the generic set stays available through variant: default', () => {
  const paths = cuePaths('done', normalizeConfig({ variant: 'default' }))
  assert.match(paths.mp3, /audio[\\/]done\.mp3$/)
  assert.doesNotMatch(paths.mp3, /friday[\\/]done\.mp3$/)
})

test('macOS plays the MP3 through afplay at the configured gain', () => {
  const [spec, ...rest] = spawnSpecs('darwin', FILES, 0.8)
  assert.equal(rest.length, 0)
  assert.equal(spec.command, 'afplay')
  assert.deepEqual(spec.args, ['-v', '0.8', MP3])
})

test('Windows plays the WAV through SoundPlayer and needs no shell quoting', () => {
  const files = { ...FILES, wav: "C:\\Users\\Zhang San\\it's here\\done.wav" }
  const [spec, ...rest] = spawnSpecs('win32', files, 0.5)
  assert.equal(rest.length, 0)
  assert.equal(spec.command, 'powershell.exe')
  assert.deepEqual(spec.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand'])

  const script = Buffer.from(spec.args[3], 'base64').toString('utf16le')
  assert.match(script, /System\.Media\.SoundPlayer/)
  assert.match(script, /PlaySync/)
  assert.match(script, /\.Volume = 50/)
  // An apostrophe in the path is doubled, so the PowerShell string survives it.
  assert.match(script, /it''s here/)
  assert.match(script, /Zhang San/)
})

test('Linux tries PulseAudio, then ffplay, then ALSA', () => {
  const specs = spawnSpecs('linux', FILES, 1)
  assert.deepEqual(specs.map(spec => spec.command), ['paplay', 'ffplay', 'aplay'])
  assert.equal(specs[0].args.at(-1), MP3)
  assert.equal(specs[2].args.at(-1), WAV)
})

test('an unknown platform yields no player', () => {
  assert.deepEqual(spawnSpecs('aix', FILES, 1), [])
})

/**
 * @param {object} [overrides] - config overrides for the handler.
 */
function handlerFor(overrides = {}) {
  const player = recordingPlayer()
  const config = normalizeConfig({ minIntervalMs: 0, ...overrides })
  const handler = createHandler({ config, player })
  return { player, handler }
}

const session = { header: { origin: 'user' } }

test('a completed turn plays the done cue', () => {
  const { player, handler } = handlerFor()
  handler(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.deepEqual(player.played, ['done'])
})

test('an interrupted turn stays silent by default', () => {
  const { player, handler } = handlerFor()
  handler(session, { type: 'turn/end', data: { reason: { kind: 'aborted' } } })
  assert.deepEqual(player.played, [])
})

test('extra turn/end reasons can be opted in', () => {
  const { player, handler } = handlerFor({ turnEndReasons: ['completed', 'error'] })
  handler(session, { type: 'turn/end', data: { reason: { kind: 'error' } } })
  assert.deepEqual(player.played, ['done'])
})

test('an approval request plays the approval cue', () => {
  const { player, handler } = handlerFor()
  handler(session, { type: 'approval/asked', data: { id: 'approval-1' } })
  assert.deepEqual(player.played, ['approval'])
})

test('a question plays the question cue exactly once per call', () => {
  const { player, handler } = handlerFor()
  const event = { type: 'tool/call', data: { name: 'ask_user_question', callId: 'call-1' } }
  handler(session, event)
  handler(session, event)
  handler(session, { type: 'tool/ptc-dispatch', data: { name: 'ask_user_question', callId: 'call-1' } })
  assert.deepEqual(player.played, ['question'])
})

test('other tool calls and non-completed reasons are ignored', () => {
  const { player, handler } = handlerFor()
  handler(session, { type: 'tool/call', data: { name: 'read_file', callId: 'call-2' } })
  handler(session, { type: 'tool/result', data: {} })
  handler(session, { type: 'step/end', data: {} })
  assert.deepEqual(player.played, [])
})

test('subagent sessions are silent unless enabled', () => {
  const subagent = { header: { origin: 'subagent' } }
  const quiet = handlerFor()
  quiet.handler(subagent, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.deepEqual(quiet.player.played, [])

  const loud = handlerFor({ includeSubagents: true })
  loud.handler(subagent, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.deepEqual(loud.player.played, ['done'])
})

test('a delegated session is recognised by origin or by depth', () => {
  assert.equal(isSubagentSession({ header: { origin: 'subagent', delegationDepth: 1 } }), true)
  assert.equal(isSubagentSession({ header: { delegationDepth: 2 } }), true)
  assert.equal(isSubagentSession({ header: { origin: 'user', delegationDepth: 0 } }), false)
  assert.equal(isSubagentSession({ header: {} }), false)
  assert.equal(isSubagentSession(undefined), false)
})

test('a session that lost its origin still stays silent', () => {
  const { player, handler } = handlerFor()
  handler({ header: { delegationDepth: 1 } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  handler({ header: { delegationDepth: 1 } }, { type: 'approval/asked', data: {} })
  assert.deepEqual(player.played, [])
})

test('the top-level session still cues', () => {
  const { player, handler } = handlerFor()
  handler({ header: { delegationDepth: 0 } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  assert.deepEqual(player.played, ['done'])
})

test('per-kind switches silence only their own cue', () => {
  const { player, handler } = handlerFor({ onTurnEnd: false, onApproval: false })
  handler(session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  handler(session, { type: 'approval/asked', data: {} })
  handler(session, { type: 'tool/call', data: { name: 'ask_user_question', callId: 'call-3' } })
  assert.deepEqual(player.played, ['question'])
})

test('the throttle keeps a burst of the same cue to one sound', () => {
  const player = recordingPlayer()
  const config = normalizeConfig({ minIntervalMs: 60_000 })
  const handler = createHandler({ config, player })
  handler(session, { type: 'approval/asked', data: { id: 'a' } })
  handler(session, { type: 'approval/asked', data: { id: 'b' } })
  assert.deepEqual(player.played, ['approval'])
})

test('the player spawns the first platform candidate', () => {
  const record = []
  const config = normalizeConfig({ volume: 0.5 })
  const files = cuePaths('done', config)
  const player = createPlayer({ platform: 'darwin', spawnImpl: recordingSpawn(record) })
  player.play('done', config, files)
  assert.equal(record.length, 1)
  assert.equal(record[0].command, 'afplay')
  assert.deepEqual(record[0].args, ['-v', '0.5', files.mp3])
  assert.equal(record[0].options.windowsHide, true)
})

test('a missing cue file warns and never spawns', () => {
  const record = []
  const warnings = []
  const player = createPlayer({ platform: 'darwin', spawnImpl: recordingSpawn(record), warn: m => warnings.push(m) })
  player.play('done', normalizeConfig(), { mp3: '/nope/done.mp3', wav: '/nope/done.wav' })
  assert.deepEqual(record, [])
  assert.match(warnings[0], /missing/)
})

test('a missing Linux player falls through to the next candidate', async () => {
  const record = []
  const spawnImpl = (command, args) => {
    const child = new EventEmitter()
    child.kill = () => {}
    child.unref = () => {}
    record.push({ command, args, child })
    if (command === 'paplay') {
      process.nextTick(() => child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' })))
    }
    return child
  }
  const config = normalizeConfig()
  const player = createPlayer({ platform: 'linux', spawnImpl })
  player.play('done', config, cuePaths('done', config))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(record.map(entry => entry.command), ['paplay', 'ffplay'])
  assert.equal(record[0].args.at(-1), cuePaths('done', config).mp3)
})

test('Windows checks the WAV, not the MP3, before spawning', () => {
  const record = []
  const warnings = []
  const player = createPlayer({ platform: 'win32', spawnImpl: recordingSpawn(record), warn: m => warnings.push(m) })
  player.play('done', normalizeConfig(), { mp3: '/nope/done.mp3', wav: '/nope/done.wav' })
  assert.deepEqual(record, [])
  assert.match(warnings[0], /done\.wav/)
})

test('an unknown platform warns once', () => {
  const warnings = []
  const player = createPlayer({ platform: 'aix', spawnImpl: recordingSpawn([]), warn: m => warnings.push(m) })
  player.play('done', normalizeConfig(), FILES)
  assert.match(warnings[0], /no audio player/)
})

test('apply subscribes to the session feed and stops the player on disposal', () => {
  const listeners = []
  let disposed = false
  const ctx = {
    logger: { warn() {} },
    effect(fn) {
      const off = fn()
      return off
    },
    on(event, fn) {
      listeners.push({ event, fn })
      return () => { disposed = true }
    },
  }
  apply(ctx, { enabled: true, minIntervalMs: 0 })
  assert.equal(listeners.length, 1)
  assert.equal(listeners[0].event, 'session/event')
  assert.equal(disposed, false)
})

test('a disabled plugin subscribes to nothing', () => {
  const listeners = []
  const ctx = {
    logger: { warn() {} },
    effect(fn) { fn() },
    on(event, fn) { listeners.push({ event, fn }) },
  }
  apply(ctx, { enabled: false })
  assert.deepEqual(listeners, [])
})
