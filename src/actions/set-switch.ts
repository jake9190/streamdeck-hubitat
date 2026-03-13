import {
	action,
	DidReceiveSettingsEvent,
	KeyUpEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";
import type { SetSwitchSettings } from "../types";
import { getImageBase64, getStateImage, getLevelImage } from "../images";
import { hubitatService } from "../hubitat-service";
import { getGlobalSettings, getInstanceState, registerInstance, unregisterInstance, updateInstanceImage } from "../plugin-state";

@action({ UUID: "com.jake.hubitat.setswitch.action" })
export class SetSwitch extends SingletonAction<SetSwitchSettings> {

	override async onWillAppear(ev: WillAppearEvent<SetSwitchSettings>): Promise<void> {
		registerInstance(ev.action.id, { switchState: "unknown", level: 0 });

		if (ev.payload.settings.device) {
			await this.pollAndUpdateImage(ev.action.id, ev.payload.settings.device, ev);
		} else {
			await ev.action.setImage(getImageBase64("light_gray"));
		}
	}

	override onWillDisappear(ev: WillDisappearEvent<SetSwitchSettings>): void {
		unregisterInstance(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SetSwitchSettings>): Promise<void> {
		if (ev.payload.settings.device) {
			await this.pollAndUpdateImage(ev.action.id, ev.payload.settings.device, ev);
		}
	}

	override async onKeyUp(ev: KeyUpEvent<SetSwitchSettings>): Promise<void> {
		const global = getGlobalSettings();
		const settings = ev.payload.settings;
		if (!global.hostname || !global.access_token || !settings.device || !settings.action) return;

		const state = getInstanceState(ev.action.id);
		if (!state) return;

		if (settings.action === "setLevel") {
			const level = parseInt(settings.level, 10);
			if (level >= 0 && level <= 100) {
				await hubitatService.sendCommand(global.hostname, global.access_token, settings.device, "setLevel", level);
				state.level = level;
			}
			if (settings.subAction && settings.subAction !== "none") {
				await hubitatService.sendCommand(global.hostname, global.access_token, settings.device, settings.subAction);
				state.switchState = settings.subAction === "on" ? "on" : "off";
			}
		} else {
			await hubitatService.sendCommand(global.hostname, global.access_token, settings.device, settings.action);
			state.switchState = settings.action === "on" ? "on" : "off";
		}

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
