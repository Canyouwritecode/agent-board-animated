import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-board-animated',
  component: 'Pane',
  requestId: 'agent-board-animated',
  props: {
    title: 'Agent board animated',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('the pane draws on every surface with no runs', async $ => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /No worker is running/ }))?.text).toBe(
      'No worker is running.',
    )
    await ui.unmount()
  }
})

test('the office is drawn where Svg exists and the list stays everywhere', async $ => {
  const editor = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const svg = await editor.find({ type: 'Svg' })

  expect(svg?.props.source).toContain('Coffee room')
  expect(svg?.props.isInteractive).toBe(true)
  await editor.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await terminal.find({ type: 'Svg' })).toBe(undefined)
  await terminal.unmount()
})
