# AgntUX/AUX-plugins

Public AgntUX plugin marketplace. Read by the host's marketplace mechanism.

AgntUX distributes its functionality as host plugins. Every plugin in `plugins/`
is listed in `.claude-plugin/marketplace.json` at the repo root. Add the
marketplace once and install plugins from it — the host handles the rest.

---

## Add to Claude Code

```
/plugin marketplace add AgntUX/AUX-plugins
/plugin install agntux-core@agntux
```

---

## Enable Auto-Updates (recommended)

Paste this into `~/.claude/settings.json` to have the host pick up new plugin
versions on every startup:

```json
{
  "extraKnownMarketplaces": {
    "agntux": { "autoUpdate": true }
  }
}
```

Without this setting, run `/plugin marketplace update` manually when you want
fresh plugin versions.

---

## Team / Managed Install

Admins can ship a managed-settings file to pre-register the marketplace for all
users in their org. See the [Claude Code managed-settings docs](https://docs.anthropic.com/en/docs/claude-code/settings#shared-project-configuration)
for the exact format. Sample snippet:

```json
{
  "extraKnownMarketplaces": {
    "agntux": {
      "autoUpdate": true
    }
  }
}
```

---

## Browse Plugins

Visit [agntux.ai/plugins](https://agntux.ai/plugins) for the rendered listing,
screenshots, and changelogs.

---

## Authoring a Plugin

See `CLAUDE.md` and `CONTRIBUTING.md` for authoring conventions, and the
`.claude/skills/` directory for maintainer tooling.

---

## License — Apache License 2.0

All plugins and shared packages in this repository are licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). See
`LICENSE` for the canonical text and `NOTICE` for attributions.

Solo use is unconditionally free — no license key, no pairing prompt, no
nag, no degradation. Sync, cross-team rollup, and the private team
marketplace are part of the proprietary AgntUX Teams product, distributed
separately.

---

## Issues / Support

- GitHub Issues: <https://github.com/AgntUX/AUX-plugins/issues>
- Email: <support@agntux.ai>
