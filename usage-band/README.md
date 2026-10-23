# usage-band

A Claude Code mod that keeps your plan usage in a band above the prompt:

```
Usage  5h ▰▰▱▱▱│▱▱▱▱ 16% 2h13m · 7d ▰▰▰▰▰│▱▱▱▱ 48% 3d4h · context ▰▰▱▱▱▱▱▱▱▱ 22%
```

- **5h / 7d**: how much of the 5-hour and 7-day windows your account has used, then the time
  until each resets.
- **Bar**: ten cells, one per 10%. Filled cells are green, amber from 70%, red from 90%, in your
  theme's colours.
- **`│` pace marker**: where usage would be if you spread it evenly through the window. Filled
  cells past the marker mean you are using it faster than that.
- **context**: how full this session's context window is: the conversation Claude keeps in
  mind (messages, replies, files read, tool output). Per session, not part of your plan's limits;
  Claude Code compacts it when it gets full.
- A toast, once per window, when 5h or 7d usage crosses the red threshold.

The figures are the ones the session itself reports (the same ones Claude Code's status line
gets), so the mod makes no network calls and spends no tokens. Usage arrives with a session's
first response; until then the band shows the last reading from an earlier session, dimmed. On
an API key, with no plan limits, it shows the context bar alone. On a narrow terminal the bars
drop out and the numbers stay. Collapse the band with ctrl+x ctrl+a.

## Options

Set in `/config` (or `pluginConfigs` in settings):

| Option | Default | What |
| --- | --- | --- |
| `warnAt` | 70 | A bar turns amber at this % |
| `criticalAt` | 90 | A bar turns red at this %, and 5h / 7d toast once when they cross it |
| `showPace` | true | The pace marker in the 5h / 7d bars |
| `showContext` | true | The context bar |
| `toast` | true | The toast near the limit |

## Notes

- It keeps the last reading per Claude config directory (`CLAUDE_CONFIG_DIR`) in the mod's own
  store, so several accounts on one machine don't mix.
- It draws the band above the prompt, which shows one mod's band at a time.
- Function-hook mods are early access; the API may change between Claude Code releases.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-band --marketplace wagnerporras/claude-mods
```

## Try it from a folder

```
claude --plugin-dir <path to this folder>
```

Tests: `claude plugin test <folder>`; checks: `claude plugin validate <folder>`.
