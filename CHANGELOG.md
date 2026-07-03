# Changelog

## 1.0.0 (2026-07-03)


### Features

* add alert sound volume control (0–200%, default 100%) ([7fd94f4](https://github.com/jacksonkr/multi-claude-hud/commit/7fd94f4dc7a6bd3c2aa7c9d4ac4892c93766b3c9))
* correct split-light colors, add subprocess timer, settings guide ([133c1d0](https://github.com/jacksonkr/multi-claude-hud/commit/133c1d0d01e0b33fbf40d86feba5cf29833775f0))
* favorites section + drag-to-reorder in the Settings terminal list ([b381c2b](https://github.com/jacksonkr/multi-claude-hud/commit/b381c2bdc316ac9b96bf39b56ccd050e094de40d))
* group "watched" terminals, add per-terminal hide, red/green done+shell ([bc78821](https://github.com/jacksonkr/multi-claude-hud/commit/bc7882188502991657a4e227f950ea00a518d7af))
* initial Multi-Claude HUD ([e1b7609](https://github.com/jacksonkr/multi-claude-hud/commit/e1b7609b81b92154ec983217a019fdeac7c01d82))
* make the sort-terminals setting a dropdown instead of radios ([cf88952](https://github.com/jacksonkr/multi-claude-hud/commit/cf88952aec036795c77d1ac2ef89fd2b7ffdbe9a))
* only flicker the time badge when its unit changes (s→m→h→d…) ([0588fc2](https://github.com/jacksonkr/multi-claude-hud/commit/0588fc2f06757493012e0216d55f193be80b785f))
* only treat long-running (&gt;15s) child processes as a background task ([20cad31](https://github.com/jacksonkr/multi-claude-hud/commit/20cad31836a64ef940a71eebf1d64ad857253ac0))
* reserve yellow for terminals waiting on your answer ([3d54952](https://github.com/jacksonkr/multi-claude-hud/commit/3d5495234bc4b6ca8b777f4a4c530508b6a7fb0b))
* split green/yellow light when finished with an attached working shell ([6df2b52](https://github.com/jacksonkr/multi-claude-hud/commit/6df2b5286ddf7bfac6c694e64b5ef975187587aa))
* working sessions stay green even with a running monitor (no split, no timer) ([dc0f2ce](https://github.com/jacksonkr/multi-claude-hud/commit/dc0f2ce05be095478ac133c616171259942eb76d))


### Bug Fixes

* don't count MCP servers as an attached subprocess ([3425d42](https://github.com/jacksonkr/multi-claude-hud/commit/3425d428fab12d25e9fa93cdbef7175e4578f3f2))
* keep the overlay as a background window (no taskbar / Alt-Tab / focus steal) ([a243c8a](https://github.com/jacksonkr/multi-claude-hud/commit/a243c8a51296b51ffbb81b0af6a26478ce5245ad))
* run tests via an explicit file list for Node 18/20 compatibility ([a93d698](https://github.com/jacksonkr/multi-claude-hud/commit/a93d6981c6decc27d7c34f9c10bd05a40dfe7672))
