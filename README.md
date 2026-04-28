# agntux/plugins

Public AgntUX plugin marketplace. Read by the host's marketplace mechanism.

AgntUX distributes its functionality as host plugins. Every plugin in `plugins/`
is listed in `.claude-plugin/marketplace.json` at the repo root. Add the
marketplace once and install plugins from it — the host handles the rest.

---

## Add to Claude Code

```
/plugin marketplace add agntux/plugins
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

## License — Elastic License 2.0 (with limitations)

All plugins in this repository are licensed under the
[Elastic License 2.0](https://www.elastic.co/licensing/elastic-license) (ELv2).
See `LICENSE` for the canonical text.

**Plain-language summary:**

- **Permitted:** Use, modify, and redistribute locally inside your own host
  installation. Install, configure, and run plugins as a paying or trial user.
- **Not permitted:**
  1. Provide the software to third parties as a hosted or managed service.
  2. Move, change, disable, or circumvent the license-check hooks.
  3. Remove or obscure licensing, copyright, or attribution notices.

For questions about specific use cases contact `legal@agntux.ai`. This summary
is not legal advice; the `LICENSE` file governs.

---

## Issues / Support

- GitHub Issues: <https://github.com/agntux/plugins/issues>
- Email: <support@agntux.ai>
