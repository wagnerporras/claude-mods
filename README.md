# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): small function-hook plugins that change
its interface. Each mod is a folder of its own; install only the ones you want.

| Mod | What it does |
| --- | --- |
| [usage-band](usage-band/) | Your plan usage in a band above the prompt: 5-hour and 7-day bars with reset countdowns and a pace marker, plus the context window. No network calls, no tokens. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-band --marketplace wagnerporras/claude-mods
```

From a shell:

```
claude plugin install usage-band --marketplace wagnerporras/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user: every session). In the desktop app,
where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with
`wagnerporras/claude-mods`, then Add plugin.

Mods use Claude Code's function hooks, which are early access: the API may change between
releases.

## Develop

```
claude --plugin-dir ./usage-band     # run a session with the mod loaded from this folder
claude plugin validate ./usage-band  # check the manifest and the hooks module
claude plugin test ./usage-band      # run its tests
```

## Licence

[MIT](LICENSE)
