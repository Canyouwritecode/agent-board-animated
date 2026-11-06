# Agent board animated

A small animated office for Claude Code. It shows the jobs Claude hands to other agents, so you can see who is working at a glance.

![The last job finishes, the office gets a pizza break, and the countdown resets](media/pizza-break.gif)

- A running job gets a desk and a computer. There are four desks; extra jobs show as "+1 more".
- An agent with no job waits in the coffee room. When two or more are there, they chat.
- Claude is the manager, in their own office. When Claude has a question for you, they walk to your office.
- You are the CEO, in the corner office.
- Every 10 finished jobs, everyone gets a pizza. A countdown shows in the coffee room.

Below the office, the panel lists running jobs and recent results as text.

## Install

Type this at the prompt of a Claude Code terminal session:

```
/plugin install agent-board-animated --marketplace Canyouwritecode/agent-board-animated
```

Answer `y` to add the marketplace, then choose a scope. Restart any chats that are already open.

## Use

The board opens by itself in a project that has a `.codex-tasks` or `.agent-tasks` folder. Anywhere else, run:

```
/agent-board-animated
```

To watch a short demo with made-up jobs:

```
/agent-board-animated demo
```

## What it shows

| Worker | Where the board finds it |
|---|---|
| Codex | `.codex-tasks/<job>.md`, with `<job>.log` and `<job>.result.md` |
| Gemini | `.agent-tasks/<job>.md`, with `<job>.log` and `<job>.result.md` |
| Claude helper | Claude Code's own subagents |

The [delegate-to-codex-gemini](https://github.com/Canyouwritecode/delegate-to-codex-gemini) skills create these folders for you. Any tool that writes the same files will work too.

## Good to know

- The animation needs the VS Code extension. The terminal has no drawing support, so it shows the text list only.
- The board needs a Claude Code version that supports mods. If it doesn't load, set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and restart.
- The text list shows job titles and the first line of each result. Keep that in mind when you share your screen or record it.
- The pizza countdown is kept per project.
- Jobs that were already finished when you installed the board don't count towards a pizza.

## Known limits

- A Codex job with a log over 4 MiB can show as working for up to 15 minutes after it stops.
- Helper filtering, the demo timers and the redraw hold have no automated tests yet.

## Development

```
claude plugin validate .
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .
```

`tsc -p .` also works once Claude Code has loaded the mod, because the engine writes the type files into `.claude-plugin/types/`. Those files are generated and stay out of git.

## Licence

MIT. See [LICENSE](LICENSE).
