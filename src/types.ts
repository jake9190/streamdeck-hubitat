import type { JsonValue } from "@elgato/utils";

/** Global settings shared across all action instances. */
export interface GlobalSettings {
	[key: string]: JsonValue;
	hostname: string;
	access_token: string;
}

/** Settings for the Toggle Switch action. */
export interface ToggleSwitchSettings {
	[key: string]: JsonValue;
	device: string;
}

/** Settings for the Set Switch action. */
export interface SetSwitchSettings {
	[key: string]: JsonValue;
	device: string;
	action: "on" | "off" | "setLevel";
	level: string;
	subAction: "on" | "off" | "none";
}

/** Settings for the Multi-Action Dimmer action. */
export interface MultiDimmerSettings {
	[key: string]: JsonValue;
	device: string;
	startingLevel: string;
}

/** Settings for the Window Shade action. */
export interface WindowShadeSettings {
	[key: string]: JsonValue;
	device: string;
}

/** Settings for the Sensor Display action. */
export interface SensorSettings {
	[key: string]: JsonValue;
	device: string;
	attribute: string;
}

/** Settings for the Weather action. */
export interface WeatherCurrentSettings {
	[key: string]: JsonValue;
	device: string;
}

/** Tracked state for an action instance (button on the deck). */
export interface InstanceState {
	switchState: "on" | "off" | "unknown";
	level: number;
	shadeState?: "open" | "closed" | "partially open" | "opening" | "closing" | "unknown";
}

/** A device event received from Hubitat's WebSocket. */
export interface HubitatDeviceEvent {
	name: string;
	displayName: string;
	deviceId: string;
	value: string;
}

/** A device attribute from the Hubitat Maker API. */
export interface DeviceAttribute {
	name: string;
	currentValue: string | number | null;
	dataType: string;
}

/** Response from polling a device via the Maker API. */
export interface DeviceResponse {
	id: number;
	name: string;
	label: string;
	attributes: DeviceAttribute[];
	capabilities: string[];
}

/** Device summary returned when listing all devices. */
export interface DeviceSummary {
	id: string;
	name: string;
	label: string;
	capabilities: string[];
}

/** Messages sent from the Property Inspector to the plugin. */
export type PIToPluginMessage =
	| { command: "getDevices" }
	| { command: "refreshDevices" };

/** Messages sent from the plugin to the Property Inspector. */
export type PluginToPIMessage =
	| { command: "deviceList"; devices: { id: string; name: string }[] }
	| { command: "error"; message: string };
