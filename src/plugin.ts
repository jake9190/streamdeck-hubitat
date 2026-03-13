import streamDeck, { type DidReceiveGlobalSettingsEvent, type SendToPluginEvent, type WillAppearEvent, type DidReceiveSettingsEvent, type PropertyInspectorDidAppearEvent } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import { ToggleSwitch } from "./actions/toggle-switch";
import { SetSwitch } from "./actions/set-switch";
import { MultiDimmer } from "./actions/multi-dimmer";
import { WindowShade } from "./actions/window-shade";
import { hubitatService } from "./hubitat-service";
import { handleDeviceEvent, setGlobalSettings, setActionRef, setActionDevice, getInstanceState, updateInstanceImage, getGlobalSettings as getCachedGlobalSettings } from "./plugin-state";
import type { GlobalSettings, HubitatDeviceEvent } from "./types";

// Register all actions
streamDeck.actions.registerAction(new ToggleSwitch());
streamDeck.actions.registerAction(new SetSwitch());
streamDeck.actions.registerAction(new MultiDimmer());
streamDeck.actions.registerAction(new WindowShade());

// When global settings are received/updated, connect the Hubitat WebSocket
streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev: DidReceiveGlobalSettingsEvent<GlobalSettings>) => {
	const settings = ev.settings;
	setGlobalSettings(settings);

	if (settings.hostname && settings.access_token) {
		hubitatService.connect(settings.hostname);

		// Push updated device list to PI if it's open
		hubitatService.getDevices(settings.hostname, settings.access_token).then(async (devices) => {
			try {
				await streamDeck.ui.sendToPropertyInspector({ command: "deviceList", devices });
				streamDeck.logger.info(`[globalSettings] Pushed ${devices.length} devices to PI`);
			} catch {
				// PI not open, ignore
			}
		});

		// Re-poll all visible actions and update their images
		for (const action of streamDeck.actions) {
			action.getSettings().then(async (s) => {
				const device = (s as Record<string, unknown>)?.device;
				if (typeof device === "string" && device) {
					setActionRef(action.id, action);
					setActionDevice(action.id, device);
					try {
						const result = await hubitatService.pollDevice(settings.hostname, settings.access_token, device);
						const state = getInstanceState(action.id);
						if (state) {
							state.switchState = result.switchState;
							state.level = result.level;
							await updateInstanceImage(action, state);
							streamDeck.logger.info(`[globalSettings] Updated image for action ${action.id} device=${device} switch=${result.switchState} level=${result.level}`);
						}
					} catch (err) {
						streamDeck.logger.warn(`[globalSettings] Failed to poll device ${device}: ${err}`);
					}
				}
			});
		}
	}
});

// Route Hubitat WebSocket events to action instances
hubitatService.onDeviceEvent(async (event: HubitatDeviceEvent) => {
	streamDeck.logger.debug(`[HubitatWS] Event: name=${event.name} deviceId=${event.deviceId} value=${event.value}`);
	if (event.name === "switch" || event.name === "level" || event.name === "windowShade" || event.name === "position") {
		await handleDeviceEvent(String(event.deviceId), event.name, event.value);
	}
});

// Handle messages from the Property Inspector (e.g., device list requests)
streamDeck.ui.onSendToPlugin(async (ev: SendToPluginEvent<JsonValue, JsonObject>) => {
	const message = ev.payload as { command?: string };
	streamDeck.logger.info(`[PI→Plugin] Received message: ${JSON.stringify(message)}`);

	if (message.command === "getDevices") {
		const settings = getCachedGlobalSettings();
		streamDeck.logger.info(`[PI→Plugin] Global settings: hostname=${settings.hostname ? "set" : "EMPTY"}, access_token=${settings.access_token ? "set" : "EMPTY"}`);
		if (settings.hostname && settings.access_token) {
			const devices = await hubitatService.getDevices(settings.hostname, settings.access_token);
			streamDeck.logger.info(`[PI→Plugin] Got ${devices.length} devices, sending to PI`);
			await streamDeck.ui.sendToPropertyInspector({ command: "deviceList", devices });
			streamDeck.logger.info(`[PI→Plugin] sendToPropertyInspector completed`);
		} else {
			streamDeck.logger.warn(`[PI→Plugin] Missing global settings, sending error to PI`);
			await streamDeck.ui.sendToPropertyInspector({ command: "error", message: "Configure API URL and Access Token first" });
		}
	}
});

// When the PI opens, proactively send the device list (avoids race with sendToPlugin)
streamDeck.ui.onDidAppear(async (ev: PropertyInspectorDidAppearEvent) => {
	streamDeck.logger.info(`[PI appeared] action=${ev.action.id} manifestId=${ev.action.manifestId}`);
	let settings = getCachedGlobalSettings();
	if (!settings.hostname || !settings.access_token) {
		// Cache not yet populated at startup — fetch directly
		streamDeck.logger.info(`[PI appeared] Cache empty, fetching global settings from SDK`);
		settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		setGlobalSettings(settings);
	}
	if (settings.hostname && settings.access_token) {
		const devices = await hubitatService.getDevices(settings.hostname, settings.access_token);
		streamDeck.logger.info(`[PI appeared] Sending ${devices.length} devices to PI`);
		await streamDeck.ui.sendToPropertyInspector({ command: "deviceList", devices });
	} else {
		streamDeck.logger.warn(`[PI appeared] Missing global settings`);
		await streamDeck.ui.sendToPropertyInspector({ command: "error", message: "Configure API URL and Access Token first" });
	}
});

// Track action instances for WS event routing
streamDeck.actions.onWillAppear(async (ev: WillAppearEvent) => {
	streamDeck.logger.info(`[willAppear] action=${ev.action.id} manifestId=${ev.action.manifestId}`);
	const settings = ev.payload.settings as Record<string, unknown>;
	if (settings && typeof settings.device === "string" && settings.device) {
		setActionRef(ev.action.id, ev.action);
		setActionDevice(ev.action.id, settings.device);
	}
});

streamDeck.settings.onDidReceiveSettings(async (ev: DidReceiveSettingsEvent) => {
	const settings = ev.payload.settings as Record<string, unknown>;
	streamDeck.logger.info(`[didReceiveSettings] action=${ev.action.id} settings=${JSON.stringify(settings)}`);
	if (settings && typeof settings.device === "string" && settings.device) {
		setActionRef(ev.action.id, ev.action);
		setActionDevice(ev.action.id, settings.device);

		// Poll device and update button image
		const global = getCachedGlobalSettings();
		if (global.hostname && global.access_token) {
			try {
				const result = await hubitatService.pollDevice(global.hostname, global.access_token, settings.device);
				const state = getInstanceState(ev.action.id);
				if (state) {
					state.switchState = result.switchState;
					state.level = result.level;
					await updateInstanceImage(ev.action, state);
					streamDeck.logger.info(`[didReceiveSettings] Updated image for action ${ev.action.id} device=${settings.device} switch=${result.switchState} level=${result.level}`);
				}
			} catch (err) {
				streamDeck.logger.warn(`[didReceiveSettings] Failed to poll device ${settings.device}: ${err}`);
			}
		}
	}
});

// Connect to Stream Deck — must be last!
streamDeck.connect().then(async () => {
	//streamDeck.logger.setLevel("debug");
	streamDeck.logger.info("=== Hubitat plugin connected and ready ===");

	// Fetch global settings on startup and connect to Hubitat
	const settings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
	setGlobalSettings(settings);
	if (settings.hostname && settings.access_token) {
		streamDeck.logger.info(`[startup] Connecting to Hubitat: ${settings.hostname}`);
		hubitatService.connect(settings.hostname);
	} else {
		streamDeck.logger.info("[startup] No global settings configured yet");
	}
});
