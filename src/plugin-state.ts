import streamDeck from "@elgato/streamdeck";
import type { GlobalSettings, InstanceState } from "./types";
import { getImageBase64, getStateImage, getLevelImage, getShadeImage } from "./images";

/**
 * Shared plugin state — tracks global settings and per-instance device state.
 * Actions import helpers from here to avoid circular dependencies with plugin.ts.
 */

let globalSettings: GlobalSettings = { hostname: "", access_token: "" };
const instanceStates = new Map<string, InstanceState>();

// Mapping from action ID to the Action object so we can push image updates from WS events.
const actionRefs = new Map<string, { setImage(image: string): Promise<void> }>();
// Mapping from action ID to device ID for WS event routing.
const actionDeviceMap = new Map<string, string>();

export function getGlobalSettings(): GlobalSettings {
	return globalSettings;
}

export function setGlobalSettings(settings: GlobalSettings): void {
	globalSettings = settings;
}

export function registerInstance(actionId: string, state: InstanceState): void {
	instanceStates.set(actionId, state);
}

export function unregisterInstance(actionId: string): void {
	instanceStates.delete(actionId);
	actionRefs.delete(actionId);
	actionDeviceMap.delete(actionId);
}

export function getInstanceState(actionId: string): InstanceState | undefined {
	return instanceStates.get(actionId);
}

export function setActionRef(actionId: string, actionRef: { setImage(image: string): Promise<void> }): void {
	actionRefs.set(actionId, actionRef);
}

export function setActionDevice(actionId: string, deviceId: string): void {
	actionDeviceMap.set(actionId, deviceId);
}

/** Update the image for an action instance based on its current state. */
export async function updateInstanceImage(
	actionRef: { setImage(image: string): Promise<void> },
	state: InstanceState,
): Promise<void> {
	let imageName: string;
	if (state.shadeState != null) {
		imageName = getShadeImage(state.shadeState);
	} else if (state.level > 0) {
		imageName = getLevelImage(state.switchState, state.level);
	} else {
		imageName = getStateImage(state.switchState);
	}
	await actionRef.setImage(getImageBase64(imageName));
}

/**
 * Handle a device event from the Hubitat WebSocket.
 * Updates all action instances that are monitoring the affected device.
 */
export async function handleDeviceEvent(deviceId: string, eventName: string, value: string): Promise<void> {
	streamDeck.logger.debug(`[handleDeviceEvent] deviceId=${deviceId} event=${eventName} value=${value} tracked=${[...actionDeviceMap.entries()].map(([a, d]) => `${a}→${d}`).join(', ')}`);
	for (const [actionId, mappedDeviceId] of actionDeviceMap.entries()) {
		if (String(mappedDeviceId) !== String(deviceId)) continue;

		const state = instanceStates.get(actionId);
		const ref = actionRefs.get(actionId);
		if (!state || !ref) continue;

		if (eventName === "switch") {
			state.switchState = value === "on" ? "on" : value === "off" ? "off" : "unknown";
		}
		if (eventName === "level") {
			state.level = parseInt(value, 10);
		}
		if (eventName === "windowShade") {
			state.shadeState = value as InstanceState["shadeState"];
		}
		if (eventName === "position") {
			state.level = parseInt(value, 10);
		}

		try {
			await updateInstanceImage(ref, state);
		} catch (err) {
			streamDeck.logger.warn(`Failed to update image for action ${actionId}: ${err}`);
		}
	}
}
