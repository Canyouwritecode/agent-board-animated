import { expect, test } from 'claude-code/testing'

import {
  briefTitle,
  clockTime,
  codexLatest,
  codexStatus,
  describeTool,
  GEMINI_LIMIT_MS,
  geminiStatus,
  groupTasks,
  QUIET_MS,
  resultLine,
} from './runs'

const NOW = 1_000_000_000

test('a Codex run works until tokens used follows the last user section', () => {
  const base = { logMtimeMs: NOW, resultSize: 10, now: NOW }
  expect(codexStatus({ ...base, log: 'user\nbrief\nexec\nx' })).toBe('working')
  expect(codexStatus({ ...base, log: 'user\ncodex\nok\ntokens used\n5' })).toBe('done')
  // A fix round reopens a finished run.
  expect(
    codexStatus({ ...base, log: 'user\ntokens used\n5\nuser\nfix\ncodex\nok' }),
  ).toBe('working')
})

test('Codex: ended empty failed, gone quiet stalled, no log briefed', () => {
  expect(
    codexStatus({ log: 'user\ntokens used\n5', logMtimeMs: NOW, resultSize: 0, now: NOW }),
  ).toBe('failed')
  expect(
    codexStatus({ log: 'user\nexec', logMtimeMs: NOW - QUIET_MS - 1, resultSize: 0, now: NOW }),
  ).toBe('stalled')
  expect(codexStatus({ resultSize: 0, now: NOW })).toBe('briefed')
})

test('Codex: no log but a written result is finished, not briefed', () => {
  expect(codexStatus({ resultSize: 378, now: NOW })).toBe('done')
})

test('Gemini: result wins, log text fails, silence works then stalls', () => {
  expect(geminiStatus({ log: '', resultSize: 5, startedAt: NOW, now: NOW })).toBe('done')
  expect(
    geminiStatus({ log: 'jetski: no output produced', resultSize: 0, startedAt: NOW, now: NOW }),
  ).toBe('failed')
  expect(geminiStatus({ log: '', resultSize: 0, startedAt: NOW, now: NOW })).toBe('working')
  expect(
    geminiStatus({ log: '', resultSize: 0, startedAt: NOW - GEMINI_LIMIT_MS - 1, now: NOW }),
  ).toBe('stalled')
  expect(geminiStatus({ resultSize: 0, now: NOW })).toBe('briefed')
})

test('files group by task, taking the newest numbered log', () => {
  const file = (name: string, mtimeMs = 1) => ({ name, size: 1, mtimeMs })
  const [task] = groupTasks([
    file('review.md'),
    file('review.result.md'),
    file('review.run1.log', 1),
    file('review.run2.log', 2),
  ])
  expect(task?.id).toBe('review')
  expect(task?.log?.name).toBe('review.run2.log')
  expect(task?.result?.name).toBe('review.result.md')
})

test('the latest line reads a command or a message', () => {
  expect(
    codexLatest(`exec\n"C:\\\\pwsh.exe" -Command 'npm run typecheck' in C:\\app\n exited 1`),
  ).toBe('Running: npm run typecheck')
  expect(codexLatest('exec\nx\ncodex\nAdded the constraint.\n')).toBe('Added the constraint.')
  expect(briefTitle('Intro\n# Task: documents table\n', 'id')).toBe('documents table')
  expect(briefTitle('no heading', 'id')).toBe('id')
})

test('the live clock is 24-hour with seconds', () => {
  expect(clockTime(new Date(2026, 10, 4, 23, 5, 9).getTime())).toBe('23:05:09')
})

test('a result line skips notes, headings and fences and drops markup', () => {
  expect(
    resultLine('notes before\n## Final report\n\n```markdown\n# Review\nThree findings need a fix.\n'),
  ).toBe('Three findings need a fix.')
  expect(resultLine('**Implemented** the migration and tests.')).toBe(
    'Implemented the migration and tests.',
  )
  expect(resultLine('Created [0002.sql](/C:/x/0002.sql) with its tests.')).toBe(
    'Created 0002.sql with its tests.',
  )
  expect(resultLine('')).toBe('')
})

test('Claude rows name handovers and never echo a raw command', () => {
  expect(describeTool('Bash', { command: 'codex exec --sandbox workspace-write -' })).toBe(
    'Handing a task to Codex',
  )
  expect(describeTool('Bash', { command: 'agy -p "x"' })).toBe('Handing a task to Gemini')
  expect(describeTool('Bash', { command: 'SECRET=1 run' })).toBe('Running a command')
  expect(describeTool('Edit', { file_path: 'C:\\a\\b.sql' })).toBe('Editing b.sql')
})
