import {
	action,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type { SensorSettings } from "../types";
import { getImageBase64, getSensorImage } from "../images";
import { hubitatService } from "../hubitat-service";
import { getGlobalSettings, registerInstance, unregisterInstance, setActionRef, setActionDevice, setActionAttribute, SENSOR_UNITS } from "../plugin-state";

/** Tracks sensor display state per action instance. */
const sensorValues = new Map<string, { attribute: string; value: string; unit: string }>();

@action({ UUID: "com.jake.hubitat.sensor.action" })
export class SensorDisplay extends SingletonAction<SensorSettings> {

	override async onWillAppear(ev: WillAppearEvent<SensorSettings>): Promise<void> {
		registerInstance(ev.action.id, { switchState: "unknown", level: 0 });

		const settings = ev.payload.settings;
		if (settings.device && settings.attribute) {
			setActionRef(ev.action.id, ev.action);
			setActionDevice(ev.action.id, settings.device);
			setActionAttribute(ev.action.id, settings.attribute);
			await this.pollAndUpdate(ev.action.id, settings.device, settings.attribute, ev.action);
		} else {
			await ev.action.setImage(getImageBase64("sensor_generic"));
			await ev.action.setTitle("Sensor");
		}
	}

	override onWillDisappear(ev: WillDisappearEvent<SensorSettings>): void {
		unregisterInstance(ev.action.id);
		sensorValues.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SensorSettings>): Promise<void> {
		const settings = ev.payload.settings;
		if (settings.device && settings.attribute) {
			setActionRef(ev.action.id, ev.action);
			setActionDevice(ev.action.id, settings.device);
			setActionAttribute(ev.action.id, settings.attribute);
			await this.pollAndUpdate(ev.action.id, settings.device, settings.attribute, ev.action);
		}
	}

	private async pollAndUpdate(
		actionId: string,
		deviceId: string,
		attribute: string,
		action: { setImage(image: string): Promise<void>; setTitle(title: string): Promise<void> },
	): Promise<void> {
		const global = getGlobalSettings();
		if (!global.hostname || !global.access_token) return;

		const attrs = await hubitatService.getDeviceAttributes(global.hostname, global.access_token, deviceId);
		const attr = attrs.find((a) => a.name === attribute);
		const value = attr?.currentValue != null ? String(attr.currentValue) : "—";
		const unit = SENSOR_UNITS[attribute] || "";

		sensorValues.set(actionId, { attribute, value, unit });

		await action.setImage(getImageBase64(getSensorImage(attribute)));
		await action.setTitle(`${value}${unit}`);
	}
}
