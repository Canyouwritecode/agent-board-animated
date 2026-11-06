import type { RunStatus } from '../types'

/** A log untouched this long, with no end marker, counts as stalled. */
export const QUIET_MS = 15 * 60 * 1000
/** Gemini runs use --print-timeout 900s; allow a minute past that. */
export const GEMINI_LIMIT_MS = 16 * 60 * 1000

export type RunFile = { name: string; size: number; mtimeMs: number }

export type TaskFiles = {
  id: string
  brief: RunFile
  log?: RunFile
  result?: RunFile
}

const lines = (text: string): string[] => text.split(/\r?\n/)

export const clip = (text: string, room = 90): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > room ? `${flat.slice(0, room - 1)}…` : flat
}

/** Groups a task folder into briefs with their newest log and their result. */
export const groupTasks = (files: readonly RunFile[]): TaskFiles[] => {
  const briefs = files.filter(
    file => file.name.endsWith('.md') && !file.name.endsWith('.result.md'),
  )

  return briefs.map(brief => {
    const id = brief.name.slice(0, -'.md'.length)
    const logs = files
      .filter(
        file =>
          file.name === `${id}.log` ||
          (file.name.startsWith(`${id}.`) && file.name.endsWith('.log')),
      )
      .sort((a, b) => b.mtimeMs - a.mtimeMs)

    return {
      id,
      brief,
      log: logs[0],
      result: files.find(file => file.name === `${id}.result.md`),
    }
  })
}

/** The first Markdown heading of a brief, without "Task:", or the file's id. */
export const briefTitle = (text: string, id: string): string => {
  const heading = lines(text).find(line => /^#{1,3}\s+\S/.test(line))

  return heading === undefined
    ? id
    : clip(heading.replace(/^#+\s+/, '').replace(/^Task:\s*/i, ''), 70)
}

const plain = (line: string): string =>
  line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/^[#\-\s]+/, '')

/**
 * The first sentence-like line of a result. Gemini writes working notes before
 * a "Final report" heading, so reading starts after that heading when present.
 */
export const resultLine = (text: string): string => {
  const all = lines(text)
  const report = all.findLastIndex(line => /^\W*final report\W*$/i.test(line))
  const line = all
    .slice(report + 1)
    .find(one => !/^\s*(#|```|\|)/.test(one) && plain(one).length >= 20)

  return line === undefined ? '' : clip(plain(line))
}

const commandOf = (line: string): string => {
  const quoted = /-Command\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(line)

  return quoted === null ? line : (quoted[1] ?? quoted[2] ?? line)
}

/** What a Codex log last shows: a command it ran or a message it wrote. */
export const codexLatest = (log: string): string => {
  const all = lines(log)
  const exec = all.lastIndexOf('exec')
  const said = all.lastIndexOf('codex')

  if (exec < 0 && said < 0) {
    return 'Starting'
  }

  if (exec > said) {
    return `Running: ${clip(commandOf(all[exec + 1] ?? ''))}`
  }

  return clip(all.slice(said + 1).find(line => line.trim() !== '') ?? 'Thinking')
}

export const codexStatus = (input: {
  log?: string
  logMtimeMs?: number
  resultSize: number
  now: number
}): RunStatus => {
  if (input.log === undefined) {
    // Not every launch keeps a log: a written result still means it finished.
    return input.resultSize > 0 ? 'done' : 'briefed'
  }

  const all = lines(input.log)
  // A fix round appends a new "user" section, so only an end marker after
  // the last one means the run has finished.
  const isEnded = all.lastIndexOf('tokens used') > all.lastIndexOf('user')

  if (isEnded) {
    return input.resultSize > 0 ? 'done' : 'failed'
  }

  return input.now - (input.logMtimeMs ?? 0) > QUIET_MS ? 'stalled' : 'working'
}

export const geminiStatus = (input: {
  log?: string
  resultSize: number
  /** When the run began: an empty result file is created at launch. */
  startedAt?: number
  now: number
}): RunStatus => {
  if (input.resultSize > 0) {
    return 'done'
  }

  if ((input.log ?? '').trim() !== '') {
    return 'failed'
  }

  if (input.startedAt === undefined) {
    return 'briefed'
  }

  return input.now - input.startedAt > GEMINI_LIMIT_MS ? 'stalled' : 'working'
}

const baseName = (path: unknown): string =>
  typeof path === 'string' ? (path.split(/[\\/]/).pop() ?? path) : 'a file'

/** One plain line for what Claude is doing. Never shows a raw shell command. */
export const describeTool = (
  tool: string,
  input: Readonly<Record<string, unknown>>,
): string => {
  const command = typeof input.command === 'string' ? input.command : ''

  if (tool === 'Bash' || tool === 'PowerShell') {
    if (/\bcodex\s+exec\b/.test(command)) {
      return 'Handing a task to Codex'
    }

    if (/\bagy\s+-p\b/.test(command)) {
      return 'Handing a task to Gemini'
    }

    return typeof input.description === 'string'
      ? clip(input.description, 70)
      : 'Running a command'
  }

  if (tool === 'Edit' || tool === 'Write') {
    return `Editing ${baseName(input.file_path)}`
  }

  if (tool === 'Read') {
    return `Reading ${baseName(input.file_path)}`
  }

  if (tool === 'Grep' || tool === 'Glob') {
    return 'Searching the project'
  }

  return `Using ${tool}`
}

/** Local 24-hour time with seconds, so each check visibly changes it. */
export const clockTime = (ms: number): string => {
  const at = new Date(ms)
  const two = (value: number): string => String(value).padStart(2, '0')

  return `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
}

export const ago = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))

  if (seconds < 60) {
    return `${seconds}s ago`
  }

  const minutes = Math.round(seconds / 60)

  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
}
