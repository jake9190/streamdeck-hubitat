import * as fs from "fs";
import * as path from "path";

const imageCache = new Map<string, string>();

/**
 * Load a PNG image from the imgs/ directory and return it as a base64 data URI.
 * Results are cached so each image is only read from disk once.
 */
export function getImageBase64(imageName: string): string {
	const cached = imageCache.get(imageName);
	if (cached) return cached;

	// In the built plugin, images are at ../imgs/ relative to bin/plugin.js
	const imgPath = path.join(__dirname, "..", "imgs", `${imageName}.png`);
	try {
		const data = fs.readFileSync(imgPath);
		const base64 = `data:image/png;base64,${data.toString("base64")}`;
		imageCache.set(imageName, base64);
		return base64;
	} catch {
		return "";
	}
}

/** Get the appropriate image name for a switch state. */
export function getStateImage(switchState: string): string {
	switch (switchState) {
		case "on":
			return "light_green";
		case "off":
			return "light_red";
		default:
			return "light_gray";
	}
}

/** Get the appropriate image name for a dimmer level + state. */
export function getLevelImage(switchState: string, level: number): string {
	if (switchState === "on") {
		if (level < 17) return "light_green_1";
		if (level < 34) return "light_green_2";
		if (level < 50) return "light_green_3";
		if (level < 67) return "light_green_4";
		if (level < 84) return "light_green_5";
		return "light_green";
	}
	if (switchState === "off") return "light_red";
	return "light_gray";
}

/** Get the appropriate image name for a window shade state. */
export function getShadeImage(shadeState: string): string {
	switch (shadeState) {
		case "open":
			return "shade_open";
		case "closed":
			return "shade_closed";
		case "partially open":
			return "shade_partial";
		case "opening":
		case "closing":
			return "shade_moving";
		default:
			return "shade_unknown";
	}
}

/** Get the appropriate icon image name for a sensor attribute type. */
export function getSensorImage(attribute: string): string {
	switch (attribute) {
		case "temperature":
			return "sensor_temperature";
		case "humidity":
			return "sensor_humidity";
		case "power":
			return "sensor_power";
		case "energy":
			return "sensor_energy";
		case "battery":
			return "sensor_battery";
		case "illuminance":
			return "sensor_illuminance";
		case "motion":
			return "sensor_motion";
		case "contact":
			return "sensor_contact";
		default:
			return "sensor_generic";
	}
}
