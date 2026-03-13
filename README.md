Based on the excellent work by ripnet @ https://github.com/ripnet/streamdeck-hubitat

![Discord](https://img.shields.io/discord/803471871617531904?style=flat-square)
![macOS](https://img.shields.io/badge/macOS-✓-success?logo=apple&style=flat-square&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-✓-success?logo=windows-95&style=flat-square&logoColor=white)
![GitHub all releases](https://img.shields.io/github/downloads/jake9190/streamdeck-hubitat/total?style=flat-square)

# streamdeck-hubitat
[Hubitat](https://hubitat.com/) integration for the [Elgato Stream Deck](https://www.elgato.com/en/gaming/stream-deck)

![](resources/readme/example.png)

# Documentation

## Introduction
This plugin uses the Hubitat's Maker API and websockets to allow Stream Deck to control devices.

**Requires Stream Deck 6.6 or later** (Node.js SDK v6).

## Setup

### Prerequisites
- [Node.js](https://nodejs.org/) 20 or later (for building from source)
- Stream Deck software 6.6+

### Hubitat
Install the [Maker API](https://docs.hubitat.com/index.php?title=Maker_API) app into Hubitat.

Make note of your `API_URL` and your `access_token`. ![](resources/readme/access_token.png)

### Stream Deck
Download the latest release from the [Releases](https://github.com/jake9190/streamdeck-hubitat/releases) page.

You should see the new category in the Stream Deck App
![](resources/readme/new_category.png)

#### Available Buttons
* **Toggle Switch** - Toggles the state of a switch from off to on, or on to off.
* **Set Switch** - Sets the state of a switch to on, off, or a specific level.
* **Multi-Action Dimmer** - Press to turn on / increase brightness, double-click to decrease brightness, hold to turn off.

Drag an action button to a free button slot. Configure the button with the `API URL` of your hubitat. Paste in your `access_token` from the Maker API.
Click away from the input field and if everything has been setup properly, the list of devices should populate. Select the device you want to control and give it a name.

![](resources/readme/global_settings.png)

## Building from Source

```bash
npm install
npm run build
```

The built plugin will be in `com.jake.hubitat.sdPlugin/`. To install for development, symlink or copy this directory to your Stream Deck plugins folder.

## Colors
Gray = No/Unknown Status

Green = Switch On

Red = Switch Off

# Architecture

This plugin is built with the [Stream Deck SDK v6](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started) (Node.js/TypeScript).

- `src/plugin.ts` — Entry point; registers actions and handles global settings
- `src/hubitat-service.ts` — WebSocket connection to Hubitat with automatic reconnection
- `src/actions/` — Individual action implementations
- `com.jake.hubitat.sdPlugin/` — Distribution directory with manifest and UI

### Reconnection

The plugin maintains a persistent WebSocket connection to Hubitat's event socket for real-time device state updates. A heartbeat watchdog automatically detects stale connections (e.g., after sleep/wake) and reconnects with exponential backoff.

# Support
Please use GitHub Issues for bugs or feature requests. Join me on my [Discord Server](https://discord.gg/J5tSRCMNbz) if you have any questions.

# License
`streamdeck-hubitat` is licensed under the [MIT License](LICENSE)
