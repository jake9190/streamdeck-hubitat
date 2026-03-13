import {
	action,
	KeyDownEvent,
	KeyUpEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type { WindowShadeSettings } from "../types";
import { getImageBase64, getShadeImage } from "../images";
import { hubitatService } from "../hubitat-service";
import { getGlobalSettings, getInstanceState, registerInstance, unregisterInstance, updateInstanceImage } from "../plugin-state";

/** Per-instance state for double-click gesture detection. */
interface GestureState {
	holdTimer: ReturnType<typeof setTimeout> | null;
	doubleClickTimer: ReturnType<typeof setTimeout> | null;
	waitingForDoubleClick: boolean;
	held: boolean;
}

const gestures = new Map<string, GestureState>();

@action({ UUID: "com.jake.hubitat.windowshade.action" })
export class WindowShade extends SingletonAction<WindowShadeSettings> {

	override async onWillAppear(ev: WillAppearEvent<WindowShadeSettings>): Promise<void> {
		registerInstance(ev.action.id, { switchState: "unknown", level: 0, shadeState: "unknown" });
		gestures.set(ev.action.id, { holdTimer: null, doubleClickTimer: null, waitingForDoubleClick: false, held: false });

		if (ev.payload.settings.device) {
			await this.pollAndUpdateImage(ev.action.id, ev.payload.settings.device, ev);
		} else {
			await ev.action.setImage(getImageBase64("shade_unknown"));
		}
	}

	override onWillDisappear(ev: WillDisappearEvent<WindowShadeSettings>): void {
		const g = gestures.get(ev.action.id);
		if (g) {
			if (g.holdTimer) clearTimeout(g.holdTimer);
			if (g.doubleClickTimer) clearTimeout(g.doubleClickTimer);
			gestures.delete(ev.action.id);
		}
		unregisterInstance(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<WindowShadeSettings>): Promise<void> {
		if (ev.payload.settings.device) {
			await this.pollAndUpdateImage(ev.action.id, ev.payload.settings.device, ev);
		}
	}

	/**
	 * Gesture detection:
	 * Single press: close (or stop if moving)
	 * Double press: open
	 */
	override onKeyDown(ev: KeyDownEvent<WindowShadeSettings>): void {
		const g = gestures.get(ev.action.id);
		if (!g) return;
		g.held = false;
	}

	override async onKeyUp(ev: KeyUpEvent<WindowShadeSettings>): Promise<void> {
		const g = gestures.get(ev.action.id);
		if (!g) return;

		if (g.waitingForDoubleClick) {
			// Second press within the double-click window → open
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
				await this.onSinglePress(ev);
			}, 350);
		}
	}

	/** Single press: close, or stop if currently moving. */
	private async onSinglePress(ev: KeyUpEvent<WindowShadeSettings>): Promise<void> {
		const global = getGlobalSettings();
		const settings = ev.payload.settings;
		if (!global.hostname || !global.access_token || !settings.device) return;

		const state = getInstanceState(ev.action.id);
		if (!state) return;

		if (state.shadeState === "opening" || state.shadeState === "closing") {
			// Stop if moving
			await hubitatService.sendCommand(global.hostname, global.access_token, settings.device, "stopPositionChange");
			state.shadeState = "partially open";
		} else {
			// Close
			await hubitatService.sendCommand(global.hostname, global.access_token, settings.device, "close");
			state.shadeState = "closing";
		}

		await updateInstanceImage(ev.action, state);
	}

	/** Double press: open. */
	private async onDoubleClick(ev: KeyUpEvent<WindowShadeSettings>): Promise<void> {
		const global = getGlobalSettings();
		const settings = ev.payload.settings;
		if (!global.hostname || !global.access_token || !settings.device) return;

		const state = getInstanceState(ev.action.id);
		if (!state) return;

		await hubitatService.sendCommand(global.hostname, global.access_token, settings.device, "open");
		state.shadeState = "opening";

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
		if (result.windowShade) {
			state.shadeState = result.windowShade as typeof state.shadeState;
		}

		const imageName = state.shadeState ? getShadeImage(state.shadeState) : getShadeImage("unknown");
		await ev.action.setImage(getImageBase64(imageName));
	}
}
