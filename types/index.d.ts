/** Helper is a Claude subagent: a worker, never the manager. */
export type Agent = 'Codex' | 'Gemini' | 'Helper'
export type RunStatus = 'briefed' | 'working' | 'done' | 'failed' | 'stalled'

export type Run = {
  id: string
  agent: Agent
  title: string
  status: RunStatus
  /** The newest thing the run did or delivered, one line. */
  latest: string
  /** When the run last changed, milliseconds since the epoch. */
  changedAt: number
}

export type Mood = 'busy' | 'waiting' | 'asking'

export type Manager = { doing: string; mood: Mood; at: number }

/** The pizza countdown, kept across sessions. */
export type Pizza = {
  /** Finished jobs still to go. */
  left: number
  /** Jobs already counted. */
  seen: string[]
  /** The party lasts until this time, milliseconds since the epoch. */
  partyUntil: number
}

/** A job sitting at a desk. */
export type Seat = { id: string; agent: Agent; label: string }

/** Everything the office drawing depends on: no times, so it only changes on a move. */
export type Scene = {
  /** Before the first look at the runs: nobody walks in from nowhere. */
  isFirst: boolean
  /** One entry per desk, in desk order; null is an empty desk. */
  desks: (Seat | null)[]
  /** Running jobs with no desk left. */
  more: number
  /** Keys of the seats whose character walks in on this drawing. */
  arriving: string[]
  /** Characters walking back to the coffee room on this drawing. */
  leaving: { agent: Agent; desk: number }[]
  mood: Mood
  /** Claude walks to the CEO office, back from it, for a coffee, or stays put. */
  managerMove: 'to-ceo' | 'back' | 'coffee' | 'none'
  /** Finished jobs until the next pizza. */
  pizzaLeft: number
  isParty: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-board-animated': {
      runs: Shaped<Run[]>
      manager: Shaped<Manager>
      scene: Shaped<Scene>
      pizza: Shaped<Pizza>
      now: number
    }
  }
}
