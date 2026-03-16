import WebSocket from "ws";
import streamDeck from "@elgato/streamdeck";
import type { DeviceResponse, DeviceSummary, GlobalSettings, HubitatDeviceEvent } from "./types";

type DeviceEventCallback = (event: HubitatDeviceEvent) => void;

const MIN_RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_TIMEOUT = 90000;

/**
 * Manages the WebSocket connection to Hubitat's event socket and provides
 * REST API methods for polling device state and sending commands.
 *
 * Fixes from the legacy plugin:
 * - Heartbeat watchdog detects zombie connections after sleep/wake (bug #1)
 * - Closes existing WS before opening new one (bug #2)
 * - Derives ws:// vs wss:// from the API URL protocol (bug #7)
 * - Full error handling with try/catch (bug #4) and onerror (bug #8)
 * - Exponential backoff on reconnect (2s → 30s max)
 */
class HubitatService {
	private ws: WebSocket | null = null;
	private hostname = "";
	private reconnectDelay = MIN_RECONNECT_DELAY;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
	private intentionalClose = false;
	private hasConnectedBefore = false;
	private listeners: DeviceEventCallback[] = [];
	private reconnectListeners: (() => void)[] = [];

	/** Register a callback for device events from the Hubitat WebSocket. */
	onDeviceEvent(callback: DeviceEventCallback): void {
		this.listeners.push(callback);
	}

	/** Register a callback that fires when the WebSocket reconnects after a drop. */
	onReconnect(callback: () => void): void {
		this.reconnectListeners.push(callback);
	}

	/** Connect (or reconnect) to the Hubitat event socket. */
	connect(hostname: string): void {
		this.hostname = hostname;
		this.disconnect();
		this.intentionalClose = false;

		try {
			const url = new URL(hostname);
			const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
			const wsUrl = `${wsProtocol}//${url.hostname}${url.port ? ":" + url.port : ""}/eventsocket`;

			streamDeck.logger.info(`HubitatService: connecting to ${wsUrl}`);
			this.ws = new WebSocket(wsUrl);

			this.ws.on("open", () => {
				streamDeck.logger.info("HubitatService: WebSocket connected");
				this.reconnectDelay = MIN_RECONNECT_DELAY;
				this.resetHeartbeat();
				if (this.hasConnectedBefore) {
					streamDeck.logger.info("HubitatService: reconnected — firing reconnect listeners");
					for (const listener of this.reconnectListeners) {
						listener();
					}
				}
				this.hasConnectedBefore = true;
			});

			this.ws.on("message", (raw: WebSocket.RawData) => {
				this.resetHeartbeat();
				try {
					const event = JSON.parse(raw.toString()) as HubitatDeviceEvent;
					for (const listener of this.listeners) {
						listener(event);
					}
				} catch {
					streamDeck.logger.warn("HubitatService: failed to parse WS message");
				}
			});

			this.ws.on("close", () => {
				streamDeck.logger.info("HubitatService: WebSocket closed");
				this.clearHeartbeat();
				if (!this.intentionalClose) {
					this.scheduleReconnect();
				}
			});

			this.ws.on("error", (err: Error) => {
				streamDeck.logger.error(`HubitatService: WebSocket error: ${err.message}`);
				// The 'close' event will follow, which triggers reconnect.
			});
		} catch (err) {
			streamDeck.logger.error(`HubitatService: failed to create WebSocket: ${err}`);
			this.scheduleReconnect();
		}
	}

	/** Cleanly disconnect from the Hubitat event socket. */
	disconnect(): void {
		this.intentionalClose = true;
		this.clearHeartbeat();
		this.clearReconnectTimer();

		if (this.ws) {
			try {
				this.ws.removeAllListeners();
				if (this.ws.readyState === WebSocket.OPEN) {
					this.ws.close();
				} else if (this.ws.readyState === WebSocket.CONNECTING) {
					this.ws.terminate();
				}
			} catch {
				// Ignore close errors on cleanup
			}
			this.ws = null;
		}
	}

	/** Poll a device's current state via the Maker API. */
	async pollDevice(hostname: string, accessToken: string, deviceId: string): Promise<{ switchState: "on" | "off" | "unknown"; level: number; hasLevel: boolean; windowShade?: string }> {
		const url = `${hostname}/devices/${encodeURIComponent(deviceId)}?access_token=${encodeURIComponent(accessToken)}`;
		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const data = (await response.json()) as DeviceResponse;

			let switchState: "on" | "off" | "unknown" = "unknown";
			let level = 0;
			let hasLevel = false;
			let windowShade: string | undefined;

			for (const attr of data.attributes) {
				if (attr.name === "switch" && attr.currentValue != null) {
					switchState = attr.currentValue === "on" ? "on" : attr.currentValue === "off" ? "off" : "unknown";
				}
				if (attr.name === "level" && attr.currentValue != null) {
					level = parseInt(String(attr.currentValue), 10);
					hasLevel = true;
				}
				if (attr.name === "windowShade" && attr.currentValue != null) {
					windowShade = String(attr.currentValue);
				}
			}

			return { switchState, level, hasLevel, windowShade };
		} catch (err) {
			streamDeck.logger.error(`HubitatService: pollDevice failed for device ${deviceId}: ${err}`);
			return { switchState: "unknown", level: 0, hasLevel: false };
		}
	}

	/** Send a command to a device via the Maker API. */
	async sendCommand(hostname: string, accessToken: string, deviceId: string, command: string, value?: string | number): Promise<void> {
		const commandPath = value != null && String(value).length > 0
			? `${command}/${encodeURIComponent(String(value))}`
			: command;
		const url = `${hostname}/devices/${encodeURIComponent(deviceId)}/${commandPath}?access_token=${encodeURIComponent(accessToken)}`;
		try {
			const response = await fetch(url);
			if (!response.ok) {
				streamDeck.logger.warn(`HubitatService: sendCommand got HTTP ${response.status} for ${command}`);
			}
		} catch (err) {
			streamDeck.logger.error(`HubitatService: sendCommand failed: ${err}`);
		}
	}

	/** Fetch the list of all devices from the Maker API. */
	async getDevices(hostname: string, accessToken: string): Promise<{ id: string; name: string }[]> {
		const url = `${hostname}/devices/all?access_token=${encodeURIComponent(accessToken)}`;
		streamDeck.logger.info(`[getDevices] Fetching: ${hostname}/devices/all`);
		try {
			const response = await fetch(url);
			streamDeck.logger.info(`[getDevices] Response status: ${response.status}`);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const data = (await response.json()) as DeviceSummary[];
			streamDeck.logger.info(`[getDevices] Parsed ${Array.isArray(data) ? data.length : 'non-array'} items. First: ${JSON.stringify(data[0] ?? null)}`);
			return data.map((d) => ({ id: String(d.id), name: d.label || d.name }));
		} catch (err) {
			streamDeck.logger.error(`HubitatService: getDevices failed: ${err}`);
			return [];
		}
	}

	/** Fetch the list of attributes for a specific device. */
	async getDeviceAttributes(hostname: string, accessToken: string, deviceId: string): Promise<{ name: string; currentValue: string | number | null }[]> {
		const url = `${hostname}/devices/${encodeURIComponent(deviceId)}?access_token=${encodeURIComponent(accessToken)}`;
		try {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = (await response.json()) as DeviceResponse;
			return data.attributes.map((a) => ({ name: a.name, currentValue: a.currentValue }));
		} catch (err) {
			streamDeck.logger.error(`HubitatService: getDeviceAttributes failed for device ${deviceId}: ${err}`);
			return [];
		}
	}

	/**
	 * Reset the heartbeat watchdog timer. If no message arrives within
	 * HEARTBEAT_TIMEOUT ms, force-close the connection to trigger reconnect.
	 * This is the primary fix for the sleep/wake zombie connection bug.
	 */
	private resetHeartbeat(): void {
		this.clearHeartbeat();
		this.heartbeatTimer = setTimeout(() => {
			streamDeck.logger.warn("HubitatService: heartbeat timeout — forcing reconnect");
			if (this.ws) {
				try {
					this.ws.terminate();
				} catch {
					// Ignore
				}
			}
		}, HEARTBEAT_TIMEOUT);
	}

	private clearHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearTimeout(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	/** Schedule a reconnect with exponential backoff. */
	private scheduleReconnect(): void {
		this.clearReconnectTimer();
		const delay = this.reconnectDelay;
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);

		streamDeck.logger.info(`HubitatService: reconnecting in ${delay}ms`);
		this.reconnectTimer = setTimeout(() => {
			if (this.hostname) {
				this.connect(this.hostname);
			}
		}, delay);
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}
}

export const hubitatService = new HubitatService();
