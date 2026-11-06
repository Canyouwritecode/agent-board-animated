import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, Register } from 'claude-code'

import type { Agent, Manager, Mood, Pizza, Run, RunStatus } from '../types'
import {
  ago,
  briefTitle,
  clockTime,
  codexLatest,
  codexStatus,
  describeTool,
  geminiStatus,
  groupTasks,
  resultLine,
} from './runs'
import type { RunFile, TaskFiles } from './runs'
import {
  agentName,
  countPizza,
  EMPTY_SCENE,
  jobKey,
  nextScene,
  PIZZA_EVERY,
  sceneAlt,
  sceneSvg,
  settled,
  toolMood,
  walkSeconds,
} from './scene'

const PANE = 'agent-board-animated'
const TITLE = 'Agent board animated'
const POLL_MS = 5000
const SHOWN = 10
const DEMO_STEP_MS = 8000
/** Time to let a walk end before the next redraw. */
const WALK_SLACK_MS = 250
const FOLDERS: readonly { agent: Agent; path: string }[] = [
  { agent: 'Codex', path: '.codex-tasks' },
  { agent: 'Gemini', path: '.agent-tasks' },
]
const STARTING: Manager = { doing: 'Waiting for you', mood: 'waiting', at: 0 }
const NO_PIZZA: Pizza = { left: PIZZA_EVERY, seen: [], partyUntil: 0 }

const runs = atom({ plugin: 'agent-board-animated', key: 'runs' } as const, [], {
  shape: 'runs-1',
})
const manager = atom(
  { plugin: 'agent-board-animated', key: 'manager' } as const,
  STARTING,
  { shape: 'manager-2' },
)
const scene = atom(
  { plugin: 'agent-board-animated', key: 'scene' } as const,
  EMPTY_SCENE,
  { shape: 'scene-2' },
)
const pizza = atom(
  { plugin: 'agent-board-animated', key: 'pizza' } as const,
  NO_PIZZA,
  { shape: 'pizza-1' },
)
const now = atom({ plugin: 'agent-board-animated', key: 'now' } as const, 0)

const WORDS: Record<RunStatus, string> = {
  briefed: 'Briefed',
  working: 'Working',
  done: 'Finished',
  failed: 'Failed',
  stalled: 'Stalled',
}

const fake = (id: string, agent: Agent): Run => ({
  id,
  agent,
  title: 'Demo job',
  status: 'working',
  latest: '',
  changedAt: 0,
})

type DemoStep = {
  working: Run[]
  doing: string
  mood: Mood
  left: number
  isParty?: boolean
}

/** The demo's script: who is working and what Claude is doing, step by step. */
const DEMO: readonly DemoStep[] = [
  {
    working: [fake('demo-one', 'Codex')],
    doing: 'Handing a task to Codex',
    mood: 'busy',
    left: 3,
  },
  {
    working: [
      fake('demo-one', 'Codex'),
      fake('demo-two', 'Codex'),
      fake('demo-three', 'Gemini'),
      fake('demo-helper', 'Helper'),
    ],
    doing: 'Handing a task to a helper',
    mood: 'busy',
    left: 3,
  },
  {
    working: [
      fake('demo-two', 'Codex'),
      fake('demo-three', 'Gemini'),
      fake('demo-helper', 'Helper'),
    ],
    doing: 'Using AskUserQuestion',
    mood: 'asking',
    left: 2,
  },
  {
    working: [fake('demo-two', 'Codex')],
    doing: 'Reading your answer',
    mood: 'busy',
    left: 1,
  },
  { working: [], doing: 'Pizza!', mood: 'busy', left: PIZZA_EVERY, isParty: true },
  { working: [], doing: 'Waiting for you', mood: 'waiting', left: PIZZA_EVERY },
  { working: [], doing: 'Waiting for you', mood: 'waiting', left: PIZZA_EVERY },
]

// While the demo plays it stands in for the real runs, manager and countdown.
let demoStep: number | undefined
// Each demo start takes a new number: an older demo's timer then stops itself.
let demoRun = 0
// The drawing keeps still until its walks are over, or robots would jump.
let walkUntil = 0
// Where the countdown is kept: one per project.
let pizzaKey = 'pizza'
// When each helper last changed: the engine does not say.
const helperChanges = new Map<string, { status: RunStatus; at: number }>()

const lastChange = (task: TaskFiles): number =>
  Math.max(task.brief.mtimeMs, task.log?.mtimeMs ?? 0, task.result?.mtimeMs ?? 0)

// Rereads a file only when its modified time moves.
const texts = new Map<string, { mtimeMs: number; text: string }>()

const textOf = async (
  $: EngineInterface,
  folder: string,
  file: RunFile | undefined,
): Promise<string | undefined> => {
  if (file === undefined) {
    return undefined
  }

  const path = `${folder}/${file.name}`
  const kept = texts.get(path)

  if (kept?.mtimeMs === file.mtimeMs) {
    return kept.text
  }

  const text = await $.fs.read(path).catch(() => undefined)

  // A failed read may be a passing lock: try again on the next look.
  if (text === undefined) {
    return ''
  }

  texts.set(path, { mtimeMs: file.mtimeMs, text })

  return text
}

const toRun = async (
  $: EngineInterface,
  agent: Agent,
  folder: string,
  task: TaskFiles,
  at: number,
): Promise<Run> => {
  const { id, brief, log, result } = task
  const title = briefTitle((await textOf($, folder, brief)) ?? '', id)
  const logText = await textOf($, folder, log)
  const resultSize = result?.size ?? 0
  const resultText = resultSize > 0 ? await textOf($, folder, result) : ''
  const status =
    agent === 'Codex'
      ? codexStatus({
          log: logText,
          logMtimeMs: log?.mtimeMs,
          resultSize,
          now: at,
        })
      : geminiStatus({
          log: logText,
          resultSize,
          startedAt: result?.mtimeMs,
          now: at,
        })
  const latest =
    status === 'done'
      ? resultLine(resultText ?? '')
      : status === 'failed' && agent === 'Gemini'
        ? resultLine(logText ?? '')
        : agent === 'Codex' && logText !== undefined
          ? codexLatest(logText)
          : status === 'working'
            ? 'No live detail: Gemini reports when it finishes'
            : ''

  return { id, agent, title, status, latest, changedAt: lastChange(task) }
}

const HELPER_STATUS: Record<AgentStatus, RunStatus> = {
  pending: 'working',
  running: 'working',
  waiting: 'working',
  idle: 'briefed',
  completed: 'done',
  failed: 'failed',
  killed: 'failed',
}

/** Claude's own subagents: workers at a desk, like a Codex job. */
const helpers = async ($: EngineInterface, at: number): Promise<Run[]> => {
  const agents = await $.agent.list().catch(() => [])

  return agents.map(agent => {
    const status = HELPER_STATUS[agent.status]
    const kept = helperChanges.get(agent.id)
    const changedAt = kept?.status === status ? kept.at : at
    helperChanges.set(agent.id, { status, at: changedAt })

    return {
      id: agent.id,
      agent: 'Helper' as const,
      title: agent.description === '' ? agent.type : agent.description,
      status,
      latest: '',
      changedAt,
    }
  })
}

const scan = async ($: EngineInterface, at: number): Promise<Run[]> => {
  const found = await Promise.all(
    FOLDERS.map(async ({ agent, path }) => {
      const entries = await $.fs.list(path).catch(() => [])
      const files = entries.filter(entry => entry.kind === 'file')
      const newest = groupTasks(files)
        .sort((a, b) => lastChange(b) - lastChange(a))
        .slice(0, SHOWN)

      return Promise.all(newest.map(task => toRun($, agent, path, task, at)))
    }),
  )

  return [...found.flat(), ...(await helpers($, at))].sort(
    (a, b) => b.changedAt - a.changedAt,
  )
}

/** Moves the office to match the runs and Claude; a no-move keeps the scene. */
const moveOffice = async ($: EngineInterface): Promise<void> => {
  const at = await $.clock.now()

  if (at < walkUntil) {
    return
  }

  const step = demoStep === undefined ? undefined : DEMO[demoStep]
  const list = step?.working ?? (await read($, runs))
  const mood = step?.mood ?? (await read($, manager)).mood
  const count = await read($, pizza)
  const left = step?.left ?? count.left
  const isParty = step?.isParty ?? (step === undefined && at < count.partyUntil)
  let walkMs = 0

  await update($, scene, prev => {
    if (at < walkUntil) {
      return prev
    }

    const made = nextScene(settled(prev), list, mood, { left, isParty })
    walkMs = walkSeconds(made) * 1000
    walkUntil = at + walkMs

    return made
  })

  // Clears the finished walk, and picks up whatever changed during it.
  if (walkMs > 0) {
    $.clock.after(walkMs + WALK_SLACK_MS, () => moveOffice($))
  }
}

const countFinished = async (
  $: EngineInterface,
  list: readonly Run[],
  at: number,
): Promise<void> => {
  const saved = (await $.store.get(pizzaKey)) as Pizza | undefined
  const done = list.filter(run => run.status === 'done').map(jobKey)
  const counted = countPizza(saved, done, at)

  if (counted !== undefined && counted !== saved) {
    await $.store.set(pizzaKey, counted)
  }

  await update($, pizza, () => counted ?? NO_PIZZA)
}

const refresh = async ($: EngineInterface): Promise<void> => {
  try {
    const at = await $.clock.now()
    const list = await scan($, at)

    await countFinished($, list, at)
    await update($, runs, () => list)
    await update($, now, () => at)
    await moveOffice($)
  } catch (error) {
    $.ui.log(`agent-board-animated: refresh failed: ${String(error)}`, {
      to: 'debug',
    })
  }
}

const playDemo = async (
  $: EngineInterface,
  run: number,
  step: number,
): Promise<void> => {
  if (run !== demoRun) {
    return
  }

  demoStep = step < DEMO.length ? step : undefined
  await moveOffice($)

  if (demoStep !== undefined) {
    $.clock.after(DEMO_STEP_MS, () => playDemo($, run, step + 1))
  }
}

const open = async ($: EngineInterface): Promise<boolean> => {
  const opened = await $.ui.open({ id: PANE, title: TITLE })

  return opened.isPlaced
}

const hasRunFolder = async ($: EngineInterface): Promise<boolean> => {
  const found = await Promise.all(FOLDERS.map(({ path }) => $.fs.exists(path)))

  return found.includes(true)
}

const setManager = async (
  $: EngineInterface,
  doing: string,
  mood: Mood,
): Promise<void> => {
  const at = await $.clock.now()
  await update($, manager, () => ({ doing, mood, at }))
  await moveOffice($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    pizzaKey = `pizza:${e.cwd}`

    await $.command.register({
      name: 'agent-board-animated',
      description: 'Show the animated office; add "demo" to watch it play',
    })
    await refresh($)
    $.clock.every(POLL_MS, () => refresh($))
    // Installed for every project: only open by itself where runs can exist.
    if (await hasRunFolder($)) {
      await open($)
    }

    return started
  })

  on('command.run', { command: 'agent-board-animated' }, async ($, e) => {
    await refresh($)
    const isPlaced = await open($)

    if (!isPlaced) {
      return { text: 'This surface has no room for a pane.' }
    }

    if (e.args.trim() === 'demo') {
      demoRun += 1
      await playDemo($, demoRun, 0)

      return { text: 'Playing the office demo. Those jobs are made up.' }
    }

    return { text: 'Agent board animated opened.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // A slash command may start no turn, so nothing would ever end this.
    if (e.command === undefined) {
      await setManager($, 'Reading your message', 'busy')
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A subagent's tools are a helper's work, not the manager's.
    if (e.agentId !== undefined) {
      return next(e)
    }

    const mood = toolMood(e.tool)
    await setManager($, describeTool(e.tool, e as Record<string, unknown>), mood)

    try {
      return await next(e)
    } finally {
      // Answered, refused or failed: Claude does not stay at the CEO's desk.
      if (mood === 'asking') {
        await setManager($, 'Reading your answer', 'busy')
      }
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await setManager($, 'Waiting for you', 'waiting')
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text } = table
    const demo = demoStep === undefined ? undefined : DEMO[demoStep]
    const list = demo?.working ?? (await read($, runs))
    const doing = demo?.doing ?? (await read($, manager)).doing
    const at = await read($, now)
    const office = await read($, scene)
    const active = list.filter(run => run.status === 'working')
    const waiting = list.filter(run => run.status === 'briefed')
    const earlier = list
      .filter(run => run.status !== 'working' && run.status !== 'briefed')
      .slice(0, 4)

    const row = (run: Run) => (
      <Box flexDirection="column" marginBottom={1}>
        <Text wrap="truncate-end">
          <Text bold>{agentName(run.agent)}</Text>
          {' · '}
          <Text
            bold
            color={
              run.status === 'done'
                ? 'success'
                : run.status === 'working' || run.status === 'briefed'
                  ? 'suggestion'
                  : 'warning'
            }
          >
            {WORDS[run.status]}
          </Text>
          {` · ${ago(at - run.changedAt)}`}
        </Text>
        <Text>{run.title}</Text>
        {run.latest !== '' && <Text dimColor>{run.latest}</Text>}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {'Svg' in table && (
          <Box marginBottom={1}>
            <table.Svg
              source={sceneSvg(office)}
              alt={sceneAlt(office)}
              isInteractive
            />
          </Box>
        )}
        <Box marginBottom={1}>
          <Text dimColor>
            {at === 0
              ? 'Checking for runs…'
              : demo !== undefined
                ? 'Demo · these jobs are made up'
                : `Live · checked ${clockTime(at)} · every 5 s`}
          </Text>
        </Box>
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Manager</Text>
          <Text>Claude · {doing}</Text>
        </Box>
        <Text bold>Workers now: {active.length} running</Text>
        {active.length === 0 && <Text dimColor>No worker is running.</Text>}
        {active.map(row)}
        {waiting.map(row)}
        <Box marginTop={1}>
          <Text bold>Recent</Text>
        </Box>
        {earlier.length === 0 && <Text dimColor>No delegated runs yet.</Text>}
        {earlier.map(row)}
      </Box>
    )
  })
}
