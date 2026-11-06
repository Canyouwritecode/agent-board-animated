import { expect, test } from 'claude-code/testing'

import type { Agent, Run, RunStatus } from '../types'
import {
  coffeeCrew,
  countPizza,
  EMPTY_SCENE,
  nextScene,
  PARTY_MS,
  PIZZA_EVERY,
  sceneAlt,
  sceneSvg,
  settled,
  SVG_LIMIT,
  toolMood,
  walkSeconds,
} from './scene'

const run = (
  id: string,
  status: RunStatus = 'working',
  agent: Agent = 'Codex',
): Run => ({ id, agent, title: id, status, latest: '', changedAt: 0 })

const start = (runs: Run[]) => nextScene(EMPTY_SCENE, runs, 'busy')

test('only a working run takes a desk', () => {
  const scene = start([
    run('a'),
    run('b', 'briefed'),
    run('c', 'done'),
    run('d', 'failed'),
    run('e', 'stalled'),
  ])

  expect(scene.desks.flatMap(seat => (seat === null ? [] : [seat.id]))).toEqual(['a'])
})

test('a fifth job shows as one more', () => {
  const scene = start(['a', 'b', 'c', 'd', 'e'].map(id => run(id)))

  expect(scene.desks.every(seat => seat !== null)).toBe(true)
  expect(scene.more).toBe(1)
  expect(sceneSvg(scene)).toContain('+1 more')
})

test('nobody walks on the first look', () => {
  const scene = start([run('a')])

  expect(scene.arriving).toEqual([])
  expect(scene.managerMove).toBe('none')
})

test('a new job walks in, a finished one walks out, others keep their desk', () => {
  const first = start([run('a'), run('b')])
  const second = nextScene(first, [run('b'), run('c', 'working', 'Gemini')], 'busy')

  expect(second.desks[1]?.id).toBe('b')
  expect(second.desks[0]?.id).toBe('c')
  expect(second.arriving).toEqual(['Gemini:c'])
  expect(second.leaving).toEqual([{ agent: 'Codex', desk: 0 }])
})

test('with no move the same scene comes back, so the drawing is untouched', () => {
  const first = start([run('a')])

  expect(nextScene(first, [{ ...run('a'), latest: 'new', changedAt: 9 }], 'busy')).toBe(first)
  expect(sceneSvg(first)).toBe(sceneSvg(structuredClone(first)))
})

test('Claude walks to the CEO to ask and back after', () => {
  const first = start([])
  const asking = nextScene(first, [], 'asking')
  const back = nextScene(asking, [], 'busy')

  expect(asking.managerMove).toBe('to-ceo')
  expect(sceneSvg(asking)).toContain('Needs you')
  expect(back.managerMove).toBe('back')
  expect(nextScene(settled(back), [], 'waiting').managerMove).toBe('coffee')
})

test('an agent with no job at a desk waits in the coffee room', () => {
  expect(coffeeCrew(start([]))).toEqual(['Codex', 'Gemini', 'Helper'])
  expect(coffeeCrew(start([run('a')]))).toEqual(['Gemini', 'Helper'])
})

test('the manager mood reads the tool name, never free text', () => {
  expect(toolMood('AskUserQuestion')).toBe('asking')
  expect(toolMood('ExitPlanMode')).toBe('asking')
  expect(toolMood('Bash')).toBe('busy')
})

test('a walk is drawn with the character hidden until it ends', () => {
  const first = start([])
  const walking = nextScene(first, [run('a')], 'busy')
  const svg = sceneSvg(walking)

  expect(svg).toContain('animateTransform')
  expect(walkSeconds(walking)).toBeGreaterThan(0)
  expect(svg).toContain(`begin="${walkSeconds(walking)}s"`)
  expect(svg).toContain('<g opacity="0">')
  expect(svg.match(/keyTimes="([^"]*)"/)?.[1]?.startsWith('0.000;')).toBe(true)
  expect(svg.match(/keyTimes="([^"]*)"/)?.[1]?.endsWith(';1.000')).toBe(true)
})

test('a walk ends: settling drops it, so a redraw can never replay it', () => {
  const walking = nextScene(start([]), [run('a')], 'busy')
  const calm = settled(walking)

  expect(walkSeconds(calm)).toBe(0)
  expect(sceneSvg(calm)).not.toContain('animateTransform')
  expect(calm.desks[0]?.id).toBe('a')
  expect(settled(calm)).toBe(calm)
})

test('a robot walks from the coffee room in and from its desk out', () => {
  const inward = nextScene(start([]), [run('a')], 'busy')
  const outward = nextScene(settled(inward), [], 'busy')
  const firstPoint = (scene: typeof inward) =>
    sceneSvg(scene).match(/values="([^;"]*);/)?.[1]

  expect(firstPoint(inward)).toBe('96 292')
  expect(firstPoint(outward)).toBe('60 174')
})

test('jobs with the same id on two agents both get a desk', () => {
  const scene = start([run('review'), run('review', 'working', 'Gemini')])

  expect(scene.desks.filter(seat => seat !== null).length).toBe(2)
})

test('a helper sits at a desk as a Claude helper, apart from the manager', () => {
  const scene = start([{ ...run('h1', 'working', 'Helper'), title: 'Review mod' }])
  const svg = sceneSvg(scene)

  expect(svg).toContain('Claude helper')
  expect(svg).toContain('Review mod')
  expect(coffeeCrew(scene)).toEqual(['Codex', 'Gemini'])
})

test('Claude fetches a coffee when work stops, and drinks it at the desk', () => {
  const busy = start([])
  const trip = nextScene(busy, [], 'waiting')
  const svg = sceneSvg(trip)

  expect(trip.managerMove).toBe('coffee')
  expect(svg).toContain('240 292')
  expect(sceneSvg(settled(trip))).toContain('class="sip"')
  // Coming back from asking is not a coffee run.
  const asking = nextScene(settled(trip), [], 'asking')
  expect(nextScene(settled(asking), [], 'waiting').managerMove).toBe('back')
})

test('two or more in the coffee room talk, one alone sips', () => {
  const group = sceneSvg(start([]))
  const alone = sceneSvg(start([run('a'), run('b', 'working', 'Helper')]))

  expect(group).toContain('class="say say0"')
  expect(group).toContain('class="say say1"')
  expect(alone).not.toContain('class="say say')
  expect(alone.split('</style>')[1]).toContain('class="sip"')
})

test('the countdown shows in the coffee room and turns into a party', () => {
  const counting = nextScene(EMPTY_SCENE, [], 'busy', { left: 3, isParty: false })
  const one = nextScene(counting, [], 'busy', { left: 1, isParty: false })
  const party = nextScene(one, [run('a')], 'busy', { left: 10, isParty: true })

  expect(sceneSvg(counting)).toContain('Pizza in 3 jobs')
  expect(sceneSvg(one)).toContain('Pizza in 1 job<')
  expect(sceneSvg(party)).toContain('Pizza time!')
  expect(sceneSvg(party)).toContain('<ellipse')
  expect(sceneSvg(party).match(/<polygon/g)?.length).toBe(5)
  expect(sceneSvg(one)).not.toContain('<polygon')
})

test('old jobs earn no pizza; each new finished job counts once', () => {
  expect(countPizza(undefined, [], 5)).toBe(undefined)

  const start = countPizza(undefined, ['a', 'b'], 5)!
  expect(start.left).toBe(PIZZA_EVERY)
  expect(countPizza(start, ['a', 'b'], 6)).toBe(start)

  const next = countPizza(start, ['a', 'b', 'c'], 6)!
  expect(next.left).toBe(PIZZA_EVERY - 1)
  expect(next.partyUntil).toBe(0)
})

test('the tenth job starts a party and the countdown restarts', () => {
  const close = { left: 1, seen: ['a'], partyUntil: 0 }
  const due = countPizza(close, ['a', 'b'], 100)!

  expect(due.left).toBe(PIZZA_EVERY)
  expect(due.partyUntil).toBe(100 + PARTY_MS)
  expect(countPizza(close, ['a', 'b', 'c', 'd'], 100)?.left).toBe(PIZZA_EVERY - 2)
})

test('the busiest office stays under the limit and escapes job ids', () => {
  const full = start(['a<b', 'c&d', 'e', 'f', 'g', 'h'].map(id => run(id)))
  const moved = nextScene(full, ['x', 'y', 'z', 'w'].map(id => run(id)), 'asking')

  expect(sceneSvg(moved).length).toBeLessThan(SVG_LIMIT)
  expect(sceneSvg(full)).toContain('a&lt;b')
  expect(sceneSvg(full)).toContain('c&amp;d')
  expect(sceneSvg(start([run('bad\u0001id')]))).toContain('badid')
  expect(sceneAlt(full)).toContain('4 at desks, 2 more waiting for a desk')
})
