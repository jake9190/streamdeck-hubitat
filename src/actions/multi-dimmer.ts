import {
	action,
	KeyDownEvent,
	KeyUpEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type { MultiDimmerSettings } from "../types";
import { getImageBase64, getLevelImage } from "../images";
import { hubitatService } from "../hubitat-service";
import { getGlobalSettings, getInstanceState, registerInstance, unregisterInstance, updateInstanceImage } from "../plugin-state";

/** Per-instance state for the multi-dimmer gesture detection. */
interface GestureState {
	holdTimer: ReturnType<typeof setTimeout> | null;
	doubleClickTimer: ReturnType<typeof setTimeout> | null;
	waitingForDoubleClick: boolean;
	held: boolean;
}

const gestures = new Map<string, GestureState>();

@action({ UUID: "com.jake.hubitat.multidimmer.action" })
export class MultiDimmer extends SingletonAction<MultiDimmerSettings> {

	override async onWillAppear(ev: WillAppearEvent<MultiDimmerSettings>): Promise<void> {
		registerInstance(ev.action.id, { switchState: "unknown", level: 0 });
		gestures.set(ev.action.id, { holdTimer: null, doubleClickTimer: null, waitingForDoubleClick: false, held: false });

		if (ev.payload.settings.device) {
			await this.pollAndUpdateImage(ev.action.id, ev.payload.settings.device, ev);
		} else {
			await ev.action.setImage(getImageBase64("light_gray"));
		}
	}

	override onWillDisappear(ev: WillDisappearEvent<MultiDimmerSettings>): void {
		const g = gestures.get(ev.action.id);
		if (g) {
			if (g.holdTimer) clearTimeout(g.holdTimer);
			if (g.doubleClickTimer) clearTimeout(g.doubleClickTimer);
			gestures.delete(ev.action.id);
		}
		unregisterInstance(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<MultiDimmerSettings>): Promise<void> {
		if (ev.payload.settings.device) {
			await this.pollAndUpdateImage(ev.action.id, ev.payload.settings.device, ev);
		}
	}

	/**
	 * Gesture detection: keyDown starts a 200ms hold timer.
	 * If keyUp arrives before 200ms → short press (enters double-click window).
	 * If 200ms elapses → held.
	 */
	override onKeyDown(ev: KeyDownEvent<MultiDimmerSettings>): void {
		const g = gestures.get(ev.action.id);
		if (!g) return;

		g.held = false;

		// Start hold detection timer (uses setTimeout, not setInterval — fixes bug #5)
		g.holdTimer = setTimeout(() => {
			g.holdTimer = null;
			g.held = true;
			this.onHeld(ev);
		}, 400);
	}

	override async onKeyUp(ev: KeyUpEvent<MultiDimmerSettings>): Promise<void> {
		const g = gestures.get(ev.action.id);
		if (!g) return;

		// If held, the hold handler already fired — nothing to do on keyUp
		if (g.held) {
			g.held = false;
			return;
		}

		// Cancel hold timer — this was a short press
		if (g.holdTimer) {
			clearTimeout(g.holdTimer);
			g.holdTimer = null;
		}

		if (g.waitingForDoubleClick) {
			// Second press within the double-click window → double-click
			g.waitingForDoubleClick = false;
			if (g.doubleClickTimer) {
				clearTimeout(g.doubleClickTimer);
				g.doubleClickTimer = null;
			}
			await this.onDoubleClick(ev);
		} else {
			// First short press → wait 350ms for a potential second press
			g.waitingForDoubleClick = true;
			g.doubleClickTimer = setTimeout(async () => {
				g.waitingForDoubleClick = false;
				g.doubleClickTimer = null;
				await this.onPress(ev);
			}, 350);
		}
	}

	/** Single press: if off → turn on (at startingLevel), if on → increase brightness +17%. */
	private async onPress(ev: KeyUpEvent<MultiDimmerSettings>): Promise<void> {
		const global = getGlobalSettings();
		const settings = ev.payload.settings;
		if (!global.hostname || !global.access_token || !settings.device) return;

		const state = getInstanceState(ev.action.id);
		if (!state) return;

		if (state.switchState === "off") {
			const initialLevel = parseInt(settings.startingLevel ?? "-1", 10);
			if (initialLevel > -1) {
				await hubitatService.sendCommand(global.hostname, global.access_token, settings.device, "setLevel", initialLevel);
				state.level = initialLevel;
			}
			await hubitatService.sendCommand(global.hostname, global.access_token, settings.device, "on");
			state.switchState = "on";
		} else {
			const newLevel = Math.min(state.level + 17, 100);
			await hubitatService.sendCommand(global.hostname, global.access_token, settings.device, "setLevel", String(newLevel));
			state.level = newLevel;
		}

		await updateInstanceImage(ev.action, state);
	}

	/** Double-click: decrease brightness -17%, turn off if < 1. */
	private async onDoubleClick(ev: KeyUpEvent<MultiDimmerSettings>): Promise<void> {
		const global = getGlobalSettings();
		const settings = ev.payload.settings;
		if (!global.hostname || !global.access_token || !settings.device) return;

		const state = getInstanceState(ev.action.id);
		if (!state) return;

		const newLevel = state.level - 17;

		if (newLevel < 1) {
			await hubitatService.sendCommand(global.hostname, global.access_token, settings.device, "off");
			state.switchState = "off";
		} else {
			await hubitatService.sendCommand(global.hostname, global.access_token, settings.device, "setLevel", String(newLevel));
			state.level = newLevel;
		}

		await updateInstanceImage(ev.action, state);
	}

	/** Hold (200ms+): turn off. */
	private async onHeld(ev: KeyDownEvent<MultiDimmerSettings>): Promise<void> {
		const global = getGlobalSettings();
		const settings = ev.payload.settings;
		if (!global.hostname || !global.access_token || !settings.device) return;

		const state = getInstanceState(ev.action.id);
		if (!state) return;

		await hubitatService.sendCommand(global.hostname, global.access_token, settings.device, "off");
		state.switchState = "off";
		await updateInstanceImage(ev.action, state);
	}

	private async pollAndUpdateImage(
		actionId: string,
		deviceId: string,
		ev: { action: { setImage(image: string): Promise<void> } },
	): Promise<void> {
		const global = getGlobalSettings();
		if (!global.hostname || !global.access_token) return;

		const result = await hubitatService.pollDevice(global.hostname, global.access_token, deviceId);
		const state = getInstanceState(actionId);
		if (!state) return;

		state.switchState = result.switchState;
		state.level = result.level;

		const imageName = getLevelImage(state.switchState, state.level);
		await ev.action.setImage(getImageBase64(imageName));
	}
}
