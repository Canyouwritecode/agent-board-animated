import type { Agent, Mood, Pizza, Run, Scene, Seat } from '../types'

export const DESKS = 4
/** Finished jobs per pizza. */
export const PIZZA_EVERY = 10
export const PARTY_MS = 30_000
/** The engine refuses an Svg source longer than this. */
export const SVG_LIMIT = 131072

const WIDTH = 360
const HEIGHT = 312
/** Walking speeds in drawing units per second. */
const SPEED = 75
const BOSS_SPEED = 120

const INK = '#e8e8e8'
const DIM = '#a4abb8'
const COLORS: Record<Agent, string> = {
  Codex: '#6ea8fe',
  Gemini: '#c4a1f7',
  Helper: '#5fd3c4',
}
const NAMES: Record<Agent, string> = {
  Codex: 'Codex',
  Gemini: 'Gemini',
  Helper: 'Claude helper',
}
const CLAUDE = '#ef9f76'
const AMBER = '#f2c14e'
const CREW: readonly Agent[] = ['Codex', 'Gemini', 'Helper']

export const agentName = (agent: Agent): string => NAMES[agent]

export const EMPTY_SCENE: Scene = {
  isFirst: true,
  desks: Array.from({ length: DESKS }, () => null),
  more: 0,
  arriving: [],
  leaving: [],
  mood: 'waiting',
  managerMove: 'none',
  pizzaLeft: PIZZA_EVERY,
  isParty: false,
}

/** Tools that stop and wait for the person. */
export const toolMood = (tool: string): Mood =>
  tool === 'AskUserQuestion' || tool === 'ExitPlanMode' ? 'asking' : 'busy'

/** Codex and Gemini ids can match, so a job is its agent and its id. */
export const jobKey = (job: { agent: Agent; id: string }): string =>
  `${job.agent}:${job.id}`

/**
 * The countdown after a look at the finished jobs. The first look at a project
 * only remembers what is already finished: old jobs earn no pizza.
 */
export const countPizza = (
  saved: Pizza | undefined,
  done: readonly string[],
  now: number,
): Pizza | undefined => {
  if (saved === undefined) {
    return done.length === 0
      ? undefined
      : { left: PIZZA_EVERY, seen: [...done], partyUntil: 0 }
  }

  const fresh = done.filter(key => !saved.seen.includes(key))

  if (fresh.length === 0) {
    return saved
  }

  const left = saved.left - fresh.length
  const isDue = left <= 0

  return {
    left: isDue ? PIZZA_EVERY + (left % PIZZA_EVERY) : left,
    seen: [...saved.seen, ...fresh].slice(-500),
    partyUntil: isDue ? now + PARTY_MS : saved.partyUntil,
  }
}

const sameSeats = (a: Scene['desks'], b: Scene['desks']): boolean =>
  a.every((seat, desk) => {
    const other = b[desk] ?? null

    return seat === null || other === null
      ? seat === other
      : jobKey(seat) === jobKey(other)
  })

/**
 * The office after a look at the runs. Jobs keep their desk, and `prev` itself
 * comes back when nobody moved, so the drawing and its loops are left alone.
 */
export const nextScene = (
  prev: Scene,
  runs: readonly Run[],
  mood: Mood,
  pizza: { left: number; isParty: boolean } = {
    left: PIZZA_EVERY,
    isParty: false,
  },
): Scene => {
  const working = runs.filter(run => run.status === 'working')
  const isWorking = (seat: Seat): boolean =>
    working.some(run => jobKey(run) === jobKey(seat))
  const desks = prev.desks.map(seat =>
    seat !== null && isWorking(seat) ? seat : null,
  )
  const queue = working
    .filter(
      run =>
        !desks.some(seat => seat !== null && jobKey(seat) === jobKey(run)),
    )
    .sort((a, b) => jobKey(a).localeCompare(jobKey(b)))
  const arriving: string[] = []

  desks.forEach((seat, desk) => {
    const run = seat === null ? queue.shift() : undefined

    if (run !== undefined) {
      desks[desk] = {
        id: run.id,
        agent: run.agent,
        label: run.agent === 'Helper' ? run.title : run.id,
      }
      arriving.push(jobKey(run))
    }
  })

  const isSame =
    !prev.isFirst &&
    sameSeats(prev.desks, desks) &&
    prev.more === queue.length &&
    prev.mood === mood &&
    prev.pizzaLeft === pizza.left &&
    prev.isParty === pizza.isParty

  if (isSame) {
    return prev
  }

  const leaving = prev.desks.flatMap((seat, desk) => {
    const now = desks[desk] ?? null

    return seat !== null && (now === null || jobKey(now) !== jobKey(seat))
      ? [{ agent: seat.agent, desk }]
      : []
  })
  const wasAsking = prev.mood === 'asking'
  const isAsking = mood === 'asking'
  const managerMove =
    wasAsking !== isAsking
      ? isAsking
        ? 'to-ceo'
        : 'back'
      : prev.mood === 'busy' && mood === 'waiting'
        ? 'coffee'
        : 'none'

  return {
    isFirst: false,
    desks,
    more: queue.length,
    arriving: prev.isFirst ? [] : arriving,
    leaving: prev.isFirst ? [] : leaving,
    mood,
    managerMove: prev.isFirst ? 'none' : managerMove,
    pizzaLeft: pizza.left,
    isParty: pizza.isParty,
  }
}

/** The scene with its walks over, so a redraw can never replay them. */
export const settled = (scene: Scene): Scene =>
  scene.arriving.length === 0 &&
  scene.leaving.length === 0 &&
  scene.managerMove === 'none'
    ? scene
    : { ...scene, arriving: [], leaving: [], managerMove: 'none' }

const seated = (scene: Scene): Seat[] =>
  scene.desks.flatMap(seat => (seat === null ? [] : [seat]))

/** Agents with no job at a desk wait in the coffee room. */
export const coffeeCrew = (scene: Scene): Agent[] =>
  CREW.filter(agent => !seated(scene).some(seat => seat.agent === agent))

/** What the drawing says, for a reader that cannot see it. */
export const sceneAlt = (scene: Scene): string => {
  const crew = coffeeCrew(scene).map(agentName)
  const desks = `${seated(scene).length} at desks${scene.more > 0 ? `, ${scene.more} more waiting for a desk` : ''}`
  const coffee =
    crew.length === 0
      ? 'nobody in the coffee room'
      : `${crew.join(' and ')} in the coffee room`
  const claude =
    scene.mood === 'asking'
      ? 'Claude needs you'
      : scene.mood === 'busy'
        ? 'Claude working'
        : 'Claude waiting for you with a coffee'

  return `Office: ${desks}, ${coffee}, ${claude}. ${pizzaWords(scene)}.`
}

/** Also drops characters XML cannot carry, so an id can't break the drawing. */
const escape = (value: string): string =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const clipLabel = (value: string, room = 14): string =>
  value.length > room ? `${value.slice(0, room - 1)}…` : value

export const pizzaWords = (scene: Scene): string =>
  scene.isParty
    ? 'Pizza time!'
    : `Pizza in ${scene.pizzaLeft} ${scene.pizzaLeft === 1 ? 'job' : 'jobs'}`

const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  extra = '',
): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra === '' ? '' : ` ${extra}`}/>`

const text = (
  x: number,
  y: number,
  value: string,
  fill = INK,
  size = 10,
  anchor: 'start' | 'middle' | 'end' = 'start',
  weight = 400,
): string =>
  `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${escape(value)}</text>`

type Pose = 'stand' | 'type' | 'sip' | 'hold' | 'walk'

/** A small robot, origin at its feet. `look` turns its eyes left or right. */
const robot = (color: string, pose: Pose, hasTie = false, look = 0): string => {
  const arm = pose === 'type' ? 'class="type"' : ''

  return [
    rect(-1, -31, 2, 5, '#8d95a5'),
    rect(-2, -33, 4, 3, color),
    rect(-7, -26, 14, 11, '#d9dee7'),
    rect(-4 + look * 2, -23, 3, 4, '#1b1d21', 'class="blink"'),
    rect(1 + look * 2, -23, 3, 4, '#1b1d21', 'class="blink"'),
    rect(-6, -15, 12, 10, color),
    hasTie ? rect(-1, -15, 2, 8, '#7a2e1d') : '',
    rect(-9, -15, 3, 8, color, arm),
    pose === 'sip'
      ? `<g class="sip">${rect(6, -15, 3, 6, color)}${rect(9, -14, 5, 5, INK)}</g>`
      : pose === 'hold'
        ? rect(6, -15, 3, 6, color) + rect(9, -14, 5, 5, INK)
        : rect(6, -15, 3, 8, color, arm),
    rect(-5, -5, 4, 5, '#4a5060', pose === 'walk' ? 'class="stepa"' : ''),
    rect(1, -5, 4, 5, '#4a5060', pose === 'walk' ? 'class="stepb"' : ''),
  ].join('')
}

/** Claude the manager: bigger than the workers, orange, with a tie. */
const boss = (pose: Pose): string =>
  `<g transform="scale(1.2)">${robot(CLAUDE, pose, true)}</g>`

/** The CEO: a person in a suit, origin at the feet. */
const ceo = (): string =>
  [
    rect(-6, -28, 12, 12, '#e3b892'),
    rect(-6, -30, 12, 5, '#3b2a20'),
    rect(-4, -23, 2, 2, '#1b1d21', 'class="blink"'),
    rect(2, -23, 2, 2, '#1b1d21', 'class="blink"'),
    rect(-7, -16, 14, 11, '#39414f'),
    rect(-2, -16, 4, 8, '#f4f4f4'),
    rect(-1, -16, 2, 8, '#c8452f'),
    rect(-10, -16, 3, 9, '#39414f'),
    rect(7, -16, 3, 9, '#39414f'),
  ].join('')

const place = (x: number, y: number, body: string): string =>
  `<g transform="translate(${x} ${y})">${body}</g>`

/** A slice of pizza, its tip at the bottom. */
const slice = (x: number, y: number): string =>
  `<g class="pulse">${place(
    x,
    y,
    `<polygon points="0,2 11,2 5.5,13" fill="${AMBER}"/>` +
      rect(0, 0, 11, 3, '#b9783f') +
      rect(3, 4, 2, 2, '#c8452f') +
      rect(6, 6, 2, 2, '#c8452f'),
  )}</g>`

type Point = readonly [number, number]

const distance = (a: Point, b: Point): number =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])

const pathLength = (points: readonly Point[]): number =>
  points.slice(1).reduce((sum, point, at) => sum + distance(points[at]!, point), 0)

/** How long a walk along these points takes, in seconds. */
const walkTime = (points: readonly Point[], speed = SPEED): number =>
  Math.round((pathLength(points) / speed) * 10) / 10

/** A character that walks these points once, then disappears. */
const walker = (
  points: readonly Point[],
  body: string,
  speed = SPEED,
): string => {
  const total = pathLength(points)
  let walked = 0
  const times = points.map((point, at) => {
    walked += at === 0 ? 0 : distance(points[at - 1]!, point)

    return (walked / total).toFixed(3)
  })
  const dur = walkTime(points, speed)
  const [x, y] = points[0]!
  const values = points.map(point => point.join(' ')).join(';')

  return (
    `<g><animate attributeName="opacity" from="1" to="0" begin="${dur}s" dur="0.01s" fill="freeze"/>` +
    `<g transform="translate(${x} ${y})"><animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${times.join(';')}" dur="${dur}s" fill="freeze"/>${body}</g></g>`
  )
}

/** Hidden until a walk ends, then shown. */
const after = (seconds: number, body: string): string =>
  seconds === 0
    ? body
    : `<g opacity="0"><animate attributeName="opacity" from="0" to="1" begin="${seconds}s" dur="0.01s" fill="freeze"/>${body}</g>`

const DESK_Y = 170
const FLOOR_Y = 204
const COFFEE_Y = 292
const DOOR_X = 180
const BOSS_DESK_Y = 68
const BOSS_CHAIR: Point = [288, BOSS_DESK_Y + 4]
const CEO_SPOT: Point = [44, 88]
const HALL_X = 266

const BOSS_WALK: Point[] = [
  BOSS_CHAIR,
  [BOSS_CHAIR[0], 88],
  CEO_SPOT,
]
const COFFEE_RUN: Point[] = [
  BOSS_CHAIR,
  [BOSS_CHAIR[0], 88],
  [HALL_X, 88],
  [HALL_X, FLOOR_Y],
  [DOOR_X, FLOOR_Y],
  [DOOR_X, COFFEE_Y],
  [240, COFFEE_Y],
]
const COFFEE_TRIP: Point[] = [...COFFEE_RUN, ...[...COFFEE_RUN].reverse().slice(1)]

const bossMoveTime = (move: Scene['managerMove']): number =>
  move === 'coffee'
    ? walkTime(COFFEE_TRIP, BOSS_SPEED)
    : move === 'none'
      ? 0
      : walkTime(BOSS_WALK, BOSS_SPEED)

/** Close together, so a crew of two or three stands in a group. */
const coffeeX = (agent: Agent): number =>
  agent === 'Codex' ? 96 : agent === 'Gemini' ? 132 : 168
const deskLeft = (desk: number): number => desk * 90
const chairX = (desk: number): number => deskLeft(desk) + 60

const route = (agent: Agent, desk: number): Point[] => [
  [coffeeX(agent), COFFEE_Y],
  [DOOR_X, COFFEE_Y],
  [DOOR_X, FLOOR_Y],
  [chairX(desk), FLOOR_Y],
  [chairX(desk), DESK_Y + 4],
]

/** How long the longest walk in this scene takes, in seconds. */
export const walkSeconds = (scene: Scene): number =>
  Math.max(
    bossMoveTime(scene.managerMove),
    ...scene.desks.map((seat, desk) =>
      seat !== null && scene.arriving.includes(jobKey(seat))
        ? walkTime(route(seat.agent, desk))
        : 0,
    ),
    ...scene.leaving.map(one => walkTime(route(one.agent, one.desk))),
  )

const room = (
  x: number,
  y: number,
  w: number,
  h: number,
  wall: string,
  floor: string,
  title: string,
): string =>
  rect(x, y, w, h, wall) +
  rect(x, y + h - 24, w, 24, floor) +
  text(x + 8, y + 14, title, INK, 10, 'start', 600)

const monitor = (x: number, y: number, isOn: boolean, tint: string): string =>
  rect(x, y, 30, 21, '#0d0f12') +
  (isOn
    ? rect(x + 2, y + 2, 26, 17, '#12233f') +
      rect(x + 4, y + 5, 16, 2, tint, 'class="flick"') +
      rect(x + 4, y + 9, 21, 2, tint, 'class="flick2"') +
      rect(x + 4, y + 13, 11, 2, tint, 'class="flick3"')
    : rect(x + 2, y + 2, 26, 17, '#23262c')) +
  rect(x + 12, y + 21, 6, 3, '#0d0f12')

const deskTop = (x: number, y: number, w: number): string =>
  rect(x, y, w, 6, '#7d5f47') +
  rect(x + 4, y + 6, 4, 10, '#5a4333') +
  rect(x + w - 8, y + 6, 4, 10, '#5a4333')

const worker = (scene: Scene, seat: Seat | null, desk: number): string => {
  const left = deskLeft(desk)
  const color = seat === null ? INK : COLORS[seat.agent]
  const delay =
    seat !== null && scene.arriving.includes(jobKey(seat))
      ? walkTime(route(seat.agent, desk))
      : 0
  const figure =
    seat === null
      ? ''
      : after(delay, place(chairX(desk), DESK_Y + 4, robot(color, 'type')))
  const label =
    seat === null
      ? text(left + 45, DESK_Y + 24, 'Free desk', DIM, 9, 'middle')
      : text(left + 45, DESK_Y + 19, agentName(seat.agent), color, 9, 'middle', 600) +
        text(left + 45, DESK_Y + 29, clipLabel(seat.label), INK, 8.5, 'middle')

  return (
    figure +
    deskTop(left + 8, DESK_Y, 74) +
    monitor(left + 14, DESK_Y - 24, seat !== null, color) +
    label +
    (scene.isParty && seat !== null ? slice(left + 70, DESK_Y - 14) : '')
  )
}

const managerOffice = (scene: Scene): string => {
  const [chair] = BOSS_CHAIR
  const isOut = scene.mood === 'asking'
  const isCoffee = scene.mood === 'waiting'
  const delay = isOut ? 0 : bossMoveTime(scene.managerMove)
  const figure = isOut
    ? ''
    : after(
        delay,
        place(chair, BOSS_CHAIR[1], boss(isCoffee ? 'sip' : 'type')) +
          (isCoffee
            ? rect(chair + 15, BOSS_DESK_Y - 24, 1, 4, DIM, 'class="steam"') +
              rect(chair + 18, BOSS_DESK_Y - 24, 1, 4, DIM, 'class="steam2"')
            : ''),
      )

  return (
    room(182, 0, 178, 96, '#2a2622', '#3a332c', 'Manager · Claude') +
    figure +
    deskTop(212, BOSS_DESK_Y, 104) +
    monitor(222, BOSS_DESK_Y - 24, scene.mood === 'busy', CLAUDE) +
    (scene.isParty && !isOut ? slice(chair + 22, BOSS_DESK_Y - 14) : '')
  )
}

const bubble = (delay: number): string =>
  after(
    delay,
    `<g class="pulse">${rect(14, 28, 68, 18, AMBER)}${rect(40, 46, 6, 5, AMBER)}${text(48, 41, 'Needs you', '#1b1d21', 10, 'middle', 700)}</g>`,
  )

const ceoOffice = (scene: Scene): string => {
  const delay = scene.managerMove === 'to-ceo' ? bossMoveTime('to-ceo') : 0
  const skyline =
    rect(12, 22, 56, 40, '#27406b') +
    rect(16, 40, 10, 22, '#16243d') +
    rect(29, 32, 12, 30, '#1b2c4a') +
    rect(44, 44, 9, 18, '#16243d') +
    rect(55, 36, 10, 26, '#1b2c4a') +
    rect(32, 36, 2, 2, AMBER, 'class="flick"') +
    rect(36, 44, 2, 2, AMBER, 'class="flick2"') +
    rect(58, 42, 2, 2, AMBER, 'class="flick3"')
  const plant =
    rect(160, 62, 10, 10, '#7d5f47') +
    rect(158, 50, 4, 12, '#3f8a5b') +
    rect(163, 44, 4, 18, '#4fa56f') +
    rect(168, 52, 4, 10, '#3f8a5b')
  const claude =
    scene.mood === 'asking'
      ? after(delay, place(CEO_SPOT[0], CEO_SPOT[1], boss('stand'))) +
        bubble(delay)
      : ''

  return (
    room(0, 0, 178, 96, '#262a35', '#333848', 'CEO · You') +
    skyline +
    plant +
    place(122, 72, ceo()) +
    deskTop(86, 68, 72) +
    rect(92, 62, 20, 6, '#c9ced8') +
    (scene.isParty ? slice(138, 54) : '') +
    claude
  )
}

/** Three dots that take turns, so a group looks like it is talking. */
const speech = (x: number, turn: number): string =>
  `<g class="say say${turn}">${rect(x - 9, COFFEE_Y - 49, 18, 11, INK)}${rect(x - 2, COFFEE_Y - 38, 4, 3, INK)}${rect(x - 6, COFFEE_Y - 45, 2, 2, '#1b1d21')}${rect(x - 1, COFFEE_Y - 45, 2, 2, '#1b1d21')}${rect(x + 4, COFFEE_Y - 45, 2, 2, '#1b1d21')}</g>`

const coffeeRoom = (scene: Scene): string => {
  const crew = coffeeCrew(scene)
  const isTalking = crew.length > 1
  const wait = (agent: Agent): number =>
    Math.max(
      0,
      ...scene.leaving
        .filter(one => one.agent === agent)
        .map(one => walkTime(route(agent, one.desk))),
    )
  const people = crew
    .map((agent, turn) => {
      const x = coffeeX(agent)
      const look = !isTalking ? 0 : turn === 0 ? 1 : -1
      const pose = isTalking ? 'hold' : 'sip'

      return after(
        wait(agent),
        `<g${isTalking ? ` class="nod nod${turn}"` : ''}>${place(x, COFFEE_Y, robot(COLORS[agent], pose, false, look))}</g>` +
          (isTalking
            ? speech(x, turn)
            : rect(x + 10, COFFEE_Y - 21, 1, 4, DIM, 'class="steam"') +
              rect(x + 13, COFFEE_Y - 21, 1, 4, DIM, 'class="steam2"')) +
          text(x, COFFEE_Y + 13, agent === 'Helper' ? 'Helper' : agent, COLORS[agent], 9, 'middle', 600) +
          (scene.isParty ? slice(x + 11, COFFEE_Y - 32) : ''),
      )
    })
    .join('')
  const machine =
    rect(250, 266, 100, 30, '#7d5f47') +
    rect(250, 262, 100, 5, '#94745a') +
    rect(286, 232, 30, 30, '#8d95a5') +
    rect(291, 238, 20, 8, '#1b1d21') +
    rect(294, 241, 4, 2, '#75d6a0', 'class="flick"') +
    rect(299, 250, 6, 8, '#4a5060') +
    rect(299, 226, 2, 5, DIM, 'class="steam"') +
    rect(304, 226, 2, 5, DIM, 'class="steam2"') +
    rect(330, 252, 7, 10, INK)
  const pizza = scene.isParty
    ? `<ellipse cx="268" cy="258" rx="16" ry="5" fill="#b9783f"/><ellipse cx="268" cy="257" rx="13" ry="4" fill="${AMBER}"/>` +
      rect(262, 256, 3, 2, '#c8452f') +
      rect(270, 255, 3, 2, '#c8452f') +
      rect(268, 258, 3, 2, '#c8452f')
    : rect(262, 252, 7, 10, INK)

  return (
    room(0, 212, 360, 100, '#23302a', '#2f3f37', 'Coffee room') +
    text(352, 226, pizzaWords(scene), AMBER, 10, 'end', 700) +
    machine +
    pizza +
    people
  )
}

const STYLE = [
  "text{font-family:'IBM Plex Sans','Segoe UI',system-ui,sans-serif}",
  'rect{shape-rendering:crispEdges}',
  '.type{animation:type .36s steps(2) infinite alternate}',
  '@keyframes type{to{transform:translateY(-2px)}}',
  '.flick{animation:flick 1.3s steps(2) infinite}',
  '.flick2{animation:flick 1.9s steps(2) infinite}',
  '.flick3{animation:flick 1.1s steps(2) infinite}',
  '@keyframes flick{50%{opacity:.25}}',
  '.blink{animation:blink 4.3s steps(1) infinite}',
  '@keyframes blink{96%{opacity:0}}',
  '.sip{animation:sip 5s ease-in-out infinite}',
  '@keyframes sip{40%{transform:translateY(0)}55%,70%{transform:translateY(-7px)}85%{transform:translateY(0)}}',
  '.steam{animation:steam 2.2s ease-out infinite}',
  '.steam2{animation:steam 2.2s ease-out .9s infinite}',
  '@keyframes steam{0%{opacity:0;transform:translateY(2px)}30%{opacity:.9}100%{opacity:0;transform:translateY(-9px)}}',
  '.stepa{animation:step .32s steps(2) infinite alternate}',
  '.stepb{animation:step .32s steps(2) .16s infinite alternate}',
  '@keyframes step{to{transform:translateY(-2px)}}',
  '.pulse{animation:pulse 1.2s ease-in-out infinite alternate}',
  '@keyframes pulse{to{transform:translateY(-2px)}}',
  '.say{opacity:0;animation:say 5.4s steps(1) infinite}',
  '.say1{animation-delay:1.8s}',
  '.say2{animation-delay:3.6s}',
  '@keyframes say{0%{opacity:1}33%{opacity:0}}',
  '.nod{animation:nod 5.4s ease-in-out infinite}',
  '.nod1{animation-delay:1.8s}',
  '.nod2{animation-delay:3.6s}',
  '@keyframes nod{0%,30%,100%{transform:translateY(0)}8%,22%{transform:translateY(-1px)}15%{transform:translateY(0)}}',
  '@media (prefers-reduced-motion:reduce){*{animation:none!important}.say0{opacity:1}}',
].join('')

/** The whole office. The same scene always gives the same string. */
export const sceneSvg = (scene: Scene): string => {
  const walks = [
    ...scene.desks.flatMap((seat, desk) =>
      seat !== null && scene.arriving.includes(jobKey(seat))
        ? [walker(route(seat.agent, desk), robot(COLORS[seat.agent], 'walk'))]
        : [],
    ),
    ...scene.leaving.map(one =>
      walker(
        route(one.agent, one.desk).reverse(),
        robot(COLORS[one.agent], 'walk'),
      ),
    ),
    scene.managerMove === 'to-ceo'
      ? walker(BOSS_WALK, boss('walk'), BOSS_SPEED)
      : '',
    scene.managerMove === 'back'
      ? walker([...BOSS_WALK].reverse(), boss('walk'), BOSS_SPEED)
      : '',
    scene.managerMove === 'coffee'
      ? walker(COFFEE_TRIP, boss('walk'), BOSS_SPEED)
      : '',
  ].join('')
  const more =
    scene.more > 0
      ? text(352, 114, `+${scene.more} more`, AMBER, 10, 'end', 700)
      : ''

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">`,
    `<style>${STYLE}</style>`,
    rect(0, 0, WIDTH, HEIGHT, '#14161a'),
    ceoOffice(scene),
    managerOffice(scene),
    rect(178, 72, 4, 24, '#333848'),
    room(0, 100, 360, 108, '#22252c', '#2d3039', 'Desks'),
    rect(HALL_X - 8, 96, 16, 4, '#3a332c'),
    more,
    scene.desks.map((seat, desk) => worker(scene, seat, desk)).join(''),
    coffeeRoom(scene),
    rect(DOOR_X - 10, 208, 20, 4, '#2d3039'),
    walks,
    '</svg>',
  ].join('')
}
