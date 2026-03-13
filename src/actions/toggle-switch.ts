import {
	action,
	DidReceiveSettingsEvent,
	KeyUpEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";
import type { ToggleSwitchSettings } from "../types";
import { getImageBase64, getStateImage, getLevelImage } from "../images";
import { hubitatService } from "../hubitat-service";
import { getGlobalSettings, getInstanceState, registerInstance, unregisterInstance, updateInstanceImage } from "../plugin-state";

@action({ UUID: "com.jake.hubitat.toggleswitch.action" })
export class ToggleSwitch extends SingletonAction<ToggleSwitchSettings> {

	override async onWillAppear(ev: WillAppearEvent<ToggleSwitchSettings>): Promise<void> {
		const settings = ev.payload.settings;
		registerInstance(ev.action.id, { switchState: "unknown", level: 0 });

		if (settings.device) {
			await this.pollAndUpdateImage(ev.action.id, settings.device, ev);
		} else {
			await ev.action.setImage(getImageBase64("light_gray"));
		}
	}

	override onWillDisappear(ev: WillDisappearEvent<ToggleSwitchSettings>): void {
		unregisterInstance(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ToggleSwitchSettings>): Promise<void> {
		if (ev.payload.settings.device) {
			await this.pollAndUpdateImage(ev.action.id, ev.payload.settings.device, ev);
		}
	}

	override async onKeyUp(ev: KeyUpEvent<ToggleSwitchSettings>): Promise<void> {
		const global = getGlobalSettings();
		if (!global.hostname || !global.access_token || !ev.payload.settings.device) return;

		const state = getInstanceState(ev.action.id);
		if (!state) return;

		const newState = state.switchState === "on" ? "off" : "on";
		await hubitatService.sendCommand(global.hostname, global.access_token, ev.payload.settings.device, newState);
		state.switchState = newState;
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

		const imageName = result.hasLevel
			? getLevelImage(state.switchState, state.level)
			: getStateImage(state.switchState);
		await ev.action.setImage(getImageBase64(imageName));
	}
}
