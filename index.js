/**
 * dsh-voice-cues — short spoken cues for the moments that need you.
 *
 * Three recorded lines, played by the host process when a turn finishes, an
 * approval is requested, or the agent asks a question. Modelled on the audio
 * hooks of Kimi Code, but driven by DSH's session feed instead of shell hooks.
 *
 * One package, three platforms: macOS plays MP3 through `afplay`, Windows
 * plays WAV through `System.Media.SoundPlayer`, Linux tries PulseAudio,
 * ffplay and ALSA in that order. Cue audio is shipped, never synthesized and
 * never fetched.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-voice-cues-friday'

/** The tool whose call is the "the agent is asking you something" moment. */
export const ASK_USER_QUESTION = 'ask_user_question'

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
export const AUDIO_DIR = join(PACKAGE_DIR, 'audio')

export const DEFAULTS = {
  enabled: true,
  onTurnEnd: true,
  onApproval: true,
  onQuestion: true,
  /** Only these `turn/end` reasons play the "done" cue. */
  turnEndReasons: ['completed'],
  /** Subagent sessions end constantly; their cues stay off unless asked for. */
  includeSubagents: false,
  /** Gain, 1 = the file's own level. macOS `afplay -v`, Windows volume %, PulseAudio %. */
  volume: 1,
  /** Never repeat the same cue faster than this, in milliseconds. */
  minIntervalMs: 600,
  /** Which shipped set to use: `friday-dongbei` (东北话, default), `friday` (普通话), `personal-dongbei` / `personal` (小鲸鱼), `dongbei` (generic 东北话) or `default` (generic). */
  variant: 'friday-dongbei',
  /** Per-cue file overrides (absolute path); empty means the shipped files. */
  audio: { done: '', approval: '', question: '' },
}

/** @typedef {'done' | 'approval' | 'question'} CueKind */

/** @typedef {ReturnType<typeof normalizeConfig>} CueConfig */

/**
 * Merge a loader row's config onto the defaults. A profile override replaces
 * the row's `config` wholesale, so every key has to survive on its own.
 * @param {unknown} raw - the row's `config` value.
 */
export function normalizeConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {}
  const audio = config.audio !== null && typeof config.audio === 'object' ? config.audio : {}
  const string = (value, fallback) => (typeof value === 'string' ? value : fallback)
  return {
    ...DEFAULTS,
    ...config,
    enabled: config.enabled !== false,
    onTurnEnd: config.onTurnEnd !== false,
    onApproval: config.onApproval !== false,
    onQuestion: config.onQuestion !== false,
    turnEndReasons: Array.isArray(config.turnEndReasons) && config.turnEndReasons.length > 0
      ? config.turnEndReasons.filter(reason => typeof reason === 'string')
      : DEFAULTS.turnEndReasons,
    includeSubagents: config.includeSubagents === true,
    variant: ['friday-dongbei', 'friday', 'personal-dongbei', 'personal', 'dongbei', 'default'].includes(config.variant) ? config.variant : 'friday-dongbei',
    volume: typeof config.volume === 'number' && Number.isFinite(config.volume)
      ? Math.min(Math.max(config.volume, 0), 4)
      : DEFAULTS.volume,
    minIntervalMs: typeof config.minIntervalMs === 'number' && Number.isFinite(config.minIntervalMs)
      ? Math.max(config.minIntervalMs, 0)
      : DEFAULTS.minIntervalMs,
    audio: {
      done: string(audio.done, ''),
      approval: string(audio.approval, ''),
      question: string(audio.question, ''),
    },
  }
}

/**
 * The files one cue can be played from: an override when set, otherwise the
 * shipped MP3 (macOS, Linux) and WAV (Windows) pair.
 * @param {CueKind} kind - cue kind.
 * @param {CueConfig} config - normalized config.
 * @returns {{ mp3: string, wav: string, override: string }}
 */
export function cuePaths(kind, config) {
  const override = config.audio[kind]
  const base = config.variant === 'default' ? AUDIO_DIR : join(AUDIO_DIR, config.variant)
  const stem = join(base, kind)
  return {
    override,
    mp3: override.length > 0 ? override : `${stem}.mp3`,
    wav: override.length > 0 ? override : `${stem}.wav`,
  }
}

/**
 * The command(s) that play one cue on a platform, in fallback order. Windows
 * uses `-EncodedCommand` (UTF-16LE base64) so paths with spaces, quotes or
 * non-ASCII characters need no shell quoting at all.
 * @param {NodeJS.Platform | string} platform - `process.platform`-shaped value.
 * @param {{ mp3: string, wav: string }} files - cue files.
 * @param {number} volume - gain, 1 = original level.
 * @returns {Array<{ command: string, args: string[] }>}
 */
export function spawnSpecs(platform, files, volume) {
  const percent = Math.round(Math.min(volume, 1) * 100)
  switch (platform) {
    case 'darwin':
      return [{ command: 'afplay', args: ['-v', String(volume), files.mp3] }]
    case 'win32': {
      const path = files.wav.replace(/'/g, "''")
      const script = [
        `$player = New-Object System.Media.SoundPlayer -ArgumentList '${path}'`,
        `$player.Volume = ${percent}`,
        '$player.PlaySync()',
      ].join('; ')
      return [{
        command: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      }]
    }
    case 'linux':
      return [
        { command: 'paplay', args: [`--volume=${Math.round(Math.min(volume, 1) * 65536)}`, files.mp3] },
        { command: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', String(percent), files.mp3] },
        { command: 'aplay', args: [files.wav] },
      ]
    default:
      return []
  }
}

/**
 * A speaker that owns exactly one playing child at a time.
 * @param {object} [options] - injection points, used by the tests.
 * @param {NodeJS.Platform | string} [options.platform] - override the platform.
 * @param {typeof spawn} [options.spawnImpl] - override the spawn function.
 * @param {(message: string) => void} [options.warn] - diagnostic sink.
 */
export function createPlayer({ platform = process.platform, spawnImpl = spawn, warn = () => {} } = {}) {
  /** @type {import('node:child_process').ChildProcess | null} */
  let active = null

  /** @param {string} file - path whose presence decides "the cue is playable". */
  function ensure(file) {
    if (existsSync(file)) return true
    warn(`cue file is missing: ${file}`)
    return false
  }

  return {
    /**
     * Play one cue, replacing whatever is playing.
     * @param {CueKind} kind - cue kind.
     * @param {CueConfig} config - normalized config.
     * @param {{ mp3: string, wav: string }} files - cue files.
     */
    play(kind, config, files) {
      const specs = spawnSpecs(platform, files, config.volume)
      if (specs.length === 0) {
        warn(`no audio player is implemented for platform "${platform}"`)
        return
      }
      // Windows reads the WAV through SoundPlayer; macOS and Linux read the
      // MP3. An override sets both to the same path.
      const primary = platform === 'win32' ? files.wav : files.mp3
      if (!ensure(primary)) return

      try {
        active?.kill()
      } catch {
        // A player that already exited is not an error.
      }
      active = null

      const attempt = index => {
        const spec = specs[index]
        if (spec === undefined) return
        let child
        try {
          // `windowsHide` keeps powershell.exe from flashing a console window
          // when DSH runs as a GUI app; it is ignored on other platforms.
          child = spawnImpl(spec.command, spec.args, { stdio: 'ignore', detached: true, windowsHide: true })
        } catch (error) {
          warn(`could not start ${spec.command}: ${error?.message ?? String(error)}`)
          return
        }
        active = child
        child?.on?.('error', error => {
          // A missing player falls through to the next candidate; anything
          // else is reported once.
          if (error?.code === 'ENOENT') attempt(index + 1)
          else warn(`${spec.command} failed: ${error?.message ?? String(error)}`)
        })
        child?.unref?.()
      }
      attempt(0)
    },

    /** Stop the current cue, if one is playing. */
    stop() {
      try {
        active?.kill()
      } catch {
        // Ignore: teardown is best effort.
      }
      active = null
    },
  }
}

/**
 * Whether a session is a delegated one. Subagents carry `origin: 'subagent'`;
 * `delegationDepth` is checked as well so a header that lost `origin` (or a
 * future spawn path that sets only the depth) still counts as delegated.
 * @param {any} session - the session a `session/event` arrived for.
 */
export function isSubagentSession(session) {
  const header = session?.header
  if (header === null || typeof header !== 'object') return false
  if (header.origin === 'subagent') return true
  return typeof header.delegationDepth === 'number' && header.delegationDepth > 0
}

/**
 * Turn session events into cues. Pure routing: the player is injected, so the
 * tests exercise every branch without making a sound.
 * @param {object} options - wiring.
 * @param {CueConfig} options.config - normalized config.
 * @param {ReturnType<typeof createPlayer>} options.player - cue speaker.
 * @param {(message: string) => void} [options.warn] - diagnostic sink.
 */
export function createHandler({ config, player, warn = () => {} }) {
  /** @type {Map<CueKind, number>} */
  const lastPlayedAt = new Map()
  /** callIds already sounded, so `tool/call` and PTC dispatch cue once. */
  const seenQuestions = new Set()

  const play = kind => {
    const now = Date.now()
    if (now - (lastPlayedAt.get(kind) ?? 0) < config.minIntervalMs) return
    lastPlayedAt.set(kind, now)
    player.play(kind, config, cuePaths(kind, config))
  }

  return (session, event) => {
    if (!config.includeSubagents && isSubagentSession(session)) return
    switch (event?.type) {
      case 'turn/end': {
        if (!config.onTurnEnd) return
        const reason = typeof event.data?.reason === 'string' ? event.data.reason : event.data?.reason?.kind
        if (typeof reason === 'string' && !config.turnEndReasons.includes(reason)) return
        play('done')
        return
      }
      case 'approval/asked': {
        if (!config.onApproval) return
        play('approval')
        return
      }
      case 'tool/call':
      case 'tool/ptc-dispatch': {
        if (!config.onQuestion || event.data?.name !== ASK_USER_QUESTION) return
        const callId = event.data?.callId ?? event.data?.toolCallId
        if (typeof callId === 'string' && callId.length > 0) {
          if (seenQuestions.has(callId)) return
          seenQuestions.add(callId)
          if (seenQuestions.size > 500) seenQuestions.clear()
        }
        play('question')
        return
      }
      default:
        return
    }
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - host context.
 * @param {unknown} rawConfig - the loader row's config.
 * @param {object} [overrides] - injection points for tests.
 */
export function apply(ctx, rawConfig, overrides = {}) {
  const config = normalizeConfig(rawConfig)
  if (!config.enabled) return

  const warn = message => ctx.logger?.warn?.(`dsh-voice-cues: ${message}`)
  const player = createPlayer({ warn, ...overrides.player })
  const handler = createHandler({ config, player, warn })

  ctx.effect(
    () => {
      const off = ctx.on('session/event', (session, event) => {
        try {
          handler(session, event)
        } catch (error) {
          warn(`handler failed: ${error?.message ?? String(error)}`)
        }
      })
      return () => {
        player.stop()
        off?.()
      }
    },
    'dsh-voice-cues: session event subscription',
  )
}
