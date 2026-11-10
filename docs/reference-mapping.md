# Reference mapping

This project adapts ideas from **QT Reusable Widget / Shortcode Manager v1.2**, a WordPress plugin supplied by the project owner (a 24-page build specification and the plugin's 15 source files). No WordPress code is reused; only concepts carry over.

## What the reference does

Users create reusable widgets (phone, WhatsApp and email buttons, call-to-action blocks, banners, social links, business hours, coupons, address cards, custom HTML) in an admin screen. Each widget gets a shortcode such as `[qt_widget id="5"]`; editing the widget updates every page that uses it. A **Text Tokens** system lets users define placeholders like `phone_number`, used as `{{phone_number}}` in content or `[qt_token key="phone_number"]`.

## Concept mapping

| Reference | This project | Notes |
|---|---|---|
| Custom post type `qt_widget` | Records in `library.json` | Stored locally and in Drive instead of the WordPress database |
| 10 widget types, one renderer that switches on type | [Action types](features.md#action-types), one dispatcher per platform | Same "registry + dispatcher" pattern |
| Shortcode `[qt_widget id]`: edit once, every placement updates | Buttons, slash commands and Codex commands reference prompt **IDs** | Same "single source of truth" idea |
| Text Tokens `{{key}}` and `[qt_token key]` | [Prompt variables](features.md#prompt-variables) `{{key}}` | Extended with built-ins and ask-when-run |
| `sanitize_key()` on token keys | Variable names normalised to `^[a-z][a-z0-9_]{0,63}$` on save and lookup | Same rule, slightly stricter |
| Canonical hidden-fields pattern: one set of named inputs is the only thing saved; panels write into it | One validated library file is the only source; panes edit a draft that is committed on save | Same goal: no field silently overwrites another |
| `qtrw_v()` returns the default only when a key is truly absent | Schema defaults applied only for missing fields, not empty strings | Same rule |
| Nonce, capability checks, `sanitize_*` on save | Schema validation on every read and write; revision check | No users/roles in a local tool |
| Admin dashboard: stat cards, quick actions, list table, type grid | Prompt Bank pane home: counts, sync status, quick actions | |
| Click-to-copy shortcode chips | **Copy** action and `$.ui.copy` | |
| Quick-add common token chips (disabled once present) | Starter pack of prompts and variables, not re-added if present | |
| Unsaved-changes warning (`beforeunload`) | Draft kept in session state and a confirm before discarding | |
| Live preview meta box | Expanded preview of a prompt with variables filled in | |
| `custom_html` widget output unescaped | **Not carried over** | Security: see [decisions.md](decisions.md) D11 |
| Help & Usage page | This documentation and in-pane help text | |

## What does not carry over

- WordPress-specific mechanics: post types, meta boxes, `wp_enqueue_*`, color pickers, PHP templates.
- Front-end rendering of HTML widgets: the output here is prompt text, never HTML.
- Business-specific widget types (phone, WhatsApp, coupon, hours, address). Their equivalent here is a saved prompt or button the user defines.
