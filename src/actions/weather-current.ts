import {
	action,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type { WeatherCurrentSettings } from "../types";
import { hubitatService } from "../hubitat-service";
import { getGlobalSettings, registerInstance, unregisterInstance, setActionRef, setActionDevice, setCompositeHandler } from "../plugin-state";

/** Determine if it's daytime (6am–8pm local). */
function isDaytime(): boolean {
	const h = new Date().getHours();
	return h >= 6 && h < 20;
}

/** WeatherFlow Tempest condition string → emoji, with day/night variants. */
const DAY_EMOJI: Record<string, string> = {
	"clear":                      "☀️",
	"sunny":                      "☀️",
	"cloudy":                     "☁️",
	"mostly cloudy":              "🌥️",
	"partly cloudy":              "⛅",
	"foggy":                      "🌫️",
	"fog":                        "🌫️",
	"rain":                       "🌧️",
	"rainy":                      "🌧️",
	"heavy rain":                 "🌧️",
	"rain likely":                "🌧️",
	"rain possible":              "🌦️",
	"light rain":                 "🌦️",
	"very light rain":            "🌦️",
	"drizzle":                    "🌦️",
	"possibly rainy":             "🌦️",
	"snow":                       "❄️",
	"heavy snow":                 "❄️",
	"light snow":                 "🌨️",
	"snow possible":              "🌨️",
	"possibly snow":              "🌨️",
	"sleet":                      "🌨️",
	"possibly sleet":             "🌨️",
	"wintry mix":                 "🌨️",
	"wintry mix likely":          "🌨️",
	"wintry mix possible":        "🌨️",
	"thunderstorm":               "⛈️",
	"thunderstorms likely":       "⛈️",
	"thunderstorms possible":     "⛈️",
	"possibly thunderstorm":      "⛈️",
	"windy":                      "💨",
	"heavy wind":                 "💨",
	"light wind":                 "🍃",
};

const NIGHT_OVERRIDES: Record<string, string> = {
	"clear":        "🌙",
	"sunny":        "🌙",
	"partly cloudy":"☁️",
};

function conditionEmoji(condition: string, nightMode = false): string {
	if (!condition) return "🌡️";
	const key = condition.toLowerCase().trim();
	if (nightMode && NIGHT_OVERRIDES[key]) return NIGHT_OVERRIDES[key];
	return DAY_EMOJI[key] ?? "🌡️";
}

/** Check if nwsAlerts JSON contains an active warning. */
function hasActiveAlert(alertsJson: string): boolean {
	if (!alertsJson || alertsJson === "[]") return false;
	try {
		const alerts = JSON.parse(alertsJson);
		return Array.isArray(alerts) && alerts.length > 0;
	} catch {
		return false;
	}
}

/** All attributes this composite action monitors. */
const WATCHED_ATTRS = new Set([
	"temperature", "humidity", "conditions",
	"todayHighTemperature", "todayLowTemperature",
	"nwsAlerts",
]);

@action({ UUID: "com.jake.hubitat.weather.current" })
export class WeatherCurrent extends SingletonAction<WeatherCurrentSettings> {

	private cache = new Map<string, Map<string, string>>();

	override async onWillAppear(ev: WillAppearEvent<WeatherCurrentSettings>): Promise<void> {
		registerInstance(ev.action.id, { switchState: "unknown", level: 0 });
		const settings = ev.payload.settings;
		if (settings.device) {
			setActionRef(ev.action.id, ev.action);
			setActionDevice(ev.action.id, settings.device);
			this.registerHandler(ev.action.id, ev.action);
			await this.pollAndRender(ev.action.id, settings.device, ev.action);
		} else {
			await ev.action.setTitle("Weather\nN/A");
		}
	}

	override onWillDisappear(ev: WillDisappearEvent<WeatherCurrentSettings>): void {
		unregisterInstance(ev.action.id);
		this.cache.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<WeatherCurrentSettings>): Promise<void> {
		const settings = ev.payload.settings;
		if (settings.device) {
			setActionRef(ev.action.id, ev.action);
			setActionDevice(ev.action.id, settings.device);
			this.registerHandler(ev.action.id, ev.action);
			await this.pollAndRender(ev.action.id, settings.device, ev.action);
		}
	}

	private registerHandler(
		actionId: string,
		actionRef: { setTitle(title: string): Promise<void>; setImage(image: string): Promise<void> },
	): void {
		setCompositeHandler(actionId, async (eventName: string, value: string) => {
			if (!WATCHED_ATTRS.has(eventName)) return;
			const vals = this.cache.get(actionId);
			if (vals) {
				vals.set(eventName, value);
				await this.render(actionRef, vals);
			}
		});
	}

	private async pollAndRender(
		actionId: string,
		deviceId: string,
		actionRef: { setTitle(title: string): Promise<void>; setImage(image: string): Promise<void> },
	): Promise<void> {
		const global = getGlobalSettings();
		if (!global.hostname || !global.access_token) return;

		const attrs = await hubitatService.getDeviceAttributes(global.hostname, global.access_token, deviceId);
		const vals = new Map<string, string>();
		for (const a of attrs) {
			if (WATCHED_ATTRS.has(a.name) && a.currentValue != null) {
				vals.set(a.name, String(a.currentValue));
			}
		}
		this.cache.set(actionId, vals);
		await this.render(actionRef, vals);
	}

	private async render(
		actionRef: { setTitle(title: string): Promise<void>; setImage(image: string): Promise<void> },
		vals: Map<string, string>,
	): Promise<void> {
		const temp = vals.get("temperature") ?? "—";
		const humidity = vals.get("humidity") ?? "—";
		const conditions = vals.get("conditions") ?? "";
		const todayHi = vals.get("todayHighTemperature") ?? "—";
		const todayLo = vals.get("todayLowTemperature") ?? "—";
		const alertsJson = vals.get("nwsAlerts") ?? "[]";

		const night = !isDaytime();
		const emoji = conditionEmoji(conditions, night);
		const alert = hasActiveAlert(alertsJson) ? "🔴 " : "";

		await actionRef.setTitle(`${alert}${emoji}\n${temp}° ${humidity}%\n\n↑${todayHi}°↓${todayLo}°`);
	}
}