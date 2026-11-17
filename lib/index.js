// @ts-check
/**
 * dsh-qwen-reasoning — host half.
 *
 * Gives Qwen models served through the llm-pi-ai provider the full set of
 * reasoning-effort levels (off / minimal / low / medium / high / xhigh / max)
 * and defaults the provider to `max`, so the DSH reasoning bar exposes every
 * level and `reasoning_effort` is actually sent to the Qwen gateway.
 *
 * Why a runtime plugin instead of a static config patch: a bundle patch replaces
 * the whole `llm-pi-ai` config wholesale (never deep-merged), which would wipe
 * the user's own providers. So this plugin reads the live providers via
 * `settings.describe()`, computes additive ops, and writes them back with
 * `settings.mutate()` (the `providers` field is volatile). The enhancement is
 * additive + idempotent: existing reasoningEfforts / reasoning / compat choices
 * are preserved, and a second run writes nothing.
 *
 * Routes (same-origin):
 *   GET  /dsh-qwen-reasoning/status   — matched models + whether they have levels
 *   POST /dsh-qwen-reasoning/apply    — enhance now (force)
 *   GET/POST /dsh-qwen-reasoning/config — plugin configuration card
 *   GET  /dsh-qwen-reasoning/client.js — self-hosted browser bundle
 * Chat command: /qwen-reasoning
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { buildReasoningOps, summarizeProviders, DEFAULT_EFFORTS } from "./reasoning.js";

export const name = "qwen-reasoning";
export const namespace = "dsh-qwen-reasoning";
/** Required services: settings (read-modify-write), chat commands, web routes. */
export const inject = ["settings", "commands", "webServer"];

const PI_AI_NAMESPACE = "llm-pi-ai";
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const BODY_LIMIT = 65_536;

export const Config = z.object({
	autoApply: z.boolean().default(true),
	providerMatch: z.string().default(""),
	modelMatch: z.string().default("qwen"),
	defaultEffort: z.string().default("max"),
	efforts: z.dict(z.union([z.string(), z.const(null)])).default({ ...DEFAULT_EFFORTS })
});

function safeMessage(error) {
	return String(error instanceof Error ? error.message : error)
		.replace(/sk-[A-Za-z0-9._-]{6,}/g, "sk-REDACTED")
		.slice(0, 200);
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > BODY_LIMIT) { reject(new Error("request body too large")); req.destroy(); return; }
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

/** Turn Loader Config's stable references into ordinary JSON-shaped values. */
function plainConfigValue(value) {
	if (value !== null && typeof value === "object" && typeof value.get === "function") return plainConfigValue(value.get());
	if (Array.isArray(value)) return value.map(plainConfigValue);
	if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, plainConfigValue(child)]));
	return value;
}

/** Read another plugin's effective config (locale) across DSH settings generations. */
function settingsValue(ctx, ns) {
	try {
		if (typeof ctx.settings?.get === "function") return ctx.settings.get(ns);
		const editor = ctx.get("configEditor");
		const entry = typeof editor?.entries === "function" ? editor.entries().find((candidate) => candidate.options?.id === ns) : undefined;
		return entry?.fiber?.config === undefined ? undefined : plainConfigValue(entry.fiber.config);
	} catch {
		return undefined;
	}
}

function shortHash(input) {
	return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

/** Inject one boot-graph row into index.html (`window.__DSH_BOOT__ = [...]`). */
function injectGraphRow(html, row) {
	const marker = "window.__DSH_BOOT__ = ";
	const start = html.indexOf(marker);
	if (start === -1) return html;
	const bodyStart = start + marker.length;
	const end = html.indexOf("</script>", bodyStart);
	if (end === -1) return html;
	let graph;
	try { graph = JSON.parse(html.slice(bodyStart, end).trim()); } catch { return html; }
	if (!Array.isArray(graph)) return html;
	if (graph.some((entry) => entry !== null && typeof entry === "object" && entry.id === row.id)) return html;
	graph.push(row);
	return html.slice(0, bodyStart) + JSON.stringify(graph).replaceAll("<", "\\u003c") + html.slice(end);
}

/** Localized text for the /qwen-reasoning command. */
function renderStatusText(result, lang) {
	const zh = lang !== "en";
	if (!result.ready) return zh ? "Qwen 推理档位：llm-pi-ai 尚未就绪，稍后重试。" : "Qwen reasoning: llm-pi-ai not ready yet, retry shortly.";
	const lines = [zh ? "Qwen 推理档位（off/minimal/low/medium/high/xhigh/max）" : "Qwen reasoning levels (off/minimal/low/medium/high/xhigh/max)"];
	if (result.models.length === 0) lines.push(zh ? "没有匹配的 qwen 模型（检查 modelMatch 配置）。" : "No matching qwen models (check modelMatch config).");
	for (const m of result.models) {
		lines.push(zh
			? `· ${m.provider}/${m.model}: ${m.hasEfforts ? "已有档位" : "无档位"}${m.reasoning ? `，默认 ${m.reasoning}` : ""}`
			: `· ${m.provider}/${m.model}: ${m.hasEfforts ? "levels set" : "no levels"}${m.reasoning ? `, default ${m.reasoning}` : ""}`);
	}
	if (result.applied) lines.push(zh ? `本次写入 ${result.ops} 项设置。` : `Wrote ${result.ops} setting(s) this run.`);
	else lines.push(zh ? "已是最新，无需写入。" : "Already up to date, nothing to write.");
	return lines.join("\n");
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} rawConfig
 */
export function apply(ctx, rawConfig = {}) {
	const legacySettings = typeof ctx.settings?.register === "function" && typeof ctx.settings?.get === "function";
	if (legacySettings) ctx.settings.register(namespace, Config, { base: rawConfig });
	let loaderConfig = legacySettings ? undefined : Config(rawConfig);
	if (!legacySettings && typeof ctx.settings?.configure === "function") {
		ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber), "dsh-qwen-reasoning: settings presentation");
	}

	const readConfig = () => {
		const stored = legacySettings ? ctx.settings.get(namespace) ?? {} : loaderConfig;
		const locale = settingsValue(ctx, "locale")?.preference ?? "zh";
		return {
			autoApply: stored.autoApply,
			providerMatch: stored.providerMatch,
			modelMatch: stored.modelMatch,
			defaultEffort: stored.defaultEffort,
			efforts: stored.efforts,
			locale
		};
	};

	const updateOwnConfig = async (patch) => {
		if (legacySettings) {
			await ctx.settings.update(namespace, patch);
			return Config(ctx.settings.get(namespace) ?? { ...rawConfig, ...patch });
		}
		const entry = ctx.fiber?.entry;
		const editor = ctx.get("configEditor");
		if (entry !== undefined && typeof editor?.edit === "function") {
			let written;
			await editor.edit(entry, (raw) => {
				const base = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
				written = { ...base, ...structuredClone(patch) };
				Config(written);
				return written;
			});
			loaderConfig = Config(written ?? { ...loaderConfig, ...patch });
			return loaderConfig;
		}
		if (typeof ctx.settings?.update === "function") {
			const ns = ctx.fiber?.entry?.options?.id ?? namespace;
			await ctx.settings.update(ns, patch);
			loaderConfig = Config(settingsValue(ctx, ns) ?? { ...loaderConfig, ...patch });
			return loaderConfig;
		}
		throw new Error("DSH has no writable configuration service for this plugin");
	};

	/** Read the live llm-pi-ai providers + revision (null until the entry mounts). */
	const readProviders = () => {
		try {
			const rows = ctx.settings.describe();
			const row = rows.find((r) => r.ns === PI_AI_NAMESPACE);
			if (!row) return null;
			const providers = row.value?.providers;
			return { providers: providers !== null && typeof providers === "object" ? providers : {}, revision: row.revision };
		} catch {
			return null;
		}
	};

	let lastAppliedAt = 0;
	const applyNow = async () => {
		const cfg = readConfig();
		const state = readProviders();
		if (!state) return { ready: false, applied: false, ops: 0, report: [], models: [] };
		const { ops, report } = buildReasoningOps(state.providers, cfg);
		if (ops.length > 0) {
			await ctx.settings.mutate(PI_AI_NAMESPACE, ops, state.revision);
			lastAppliedAt = Date.now();
			ctx.logger.info("[dsh-qwen-reasoning] wrote %d reasoning setting(s)", ops.length);
		}
		const after = readProviders();
		return { ready: true, applied: ops.length > 0, ops: ops.length, report, models: summarizeProviders((after ?? state).providers, cfg) };
	};

	const statusView = () => {
		const cfg = readConfig();
		const state = readProviders();
		if (!state) return { ready: false, autoApply: cfg.autoApply, models: [], lastAppliedAt };
		return { ready: true, autoApply: cfg.autoApply, models: summarizeProviders(state.providers, cfg), lastAppliedAt };
	};

	// ── auto sync: startup retry + change event + periodic safety net ──
	// applyNow is additive + idempotent + revision-guarded, so concurrent or
	// repeated syncs are harmless (a stale revision just conflicts and is caught).
	// No permanent in-flight guard: a hung mutate must never block later syncs.
	let syncTimer = null;
	const sync = async () => {
		try {
			if (readConfig().autoApply) await applyNow();
		} catch (error) {
			ctx.logger.warn("[dsh-qwen-reasoning] sync failed");
			ctx.logger.warn(safeMessage(error));
		}
	};
	const scheduleSync = () => {
		if (syncTimer) clearTimeout(syncTimer);
		syncTimer = setTimeout(() => { syncTimer = null; sync(); }, 250);
	};

	ctx.effect(() => {
		let attempts = 0;
		let timer = null;
		const ladder = [];
		const start = () => {
			if (readProviders()) {
				sync();
				// Re-sync shortly after mount to cover install/reconcile races
				// where the first write may conflict with the settling config.
				for (const delay of [1000, 3000, 8000]) ladder.push(setTimeout(sync, delay));
				return;
			}
			if (attempts++ >= 80) return;
			timer = setTimeout(start, 100);
		};
		start();
		// Fast path: react to llm-pi-ai config changes (describe emits this lazily).
		const off = ctx.on("settings/document-updated", (ns) => { if (ns === PI_AI_NAMESPACE) scheduleSync(); });
		// Safety net: converge even if a change event is missed. describe() is
		// cheap; mutate only runs when there is actual work to do.
		const poll = setInterval(sync, 15000);
		return () => {
			if (timer) clearTimeout(timer);
			if (syncTimer) clearTimeout(syncTimer);
			for (const t of ladder) clearTimeout(t);
			clearInterval(poll);
			if (typeof off === "function") off();
		};
	}, "dsh-qwen-reasoning: auto sync");

	// ── web routes ──
	const originAllowed = (req) => {
		const origin = req.headers.origin;
		if (typeof origin !== "string" || origin.length === 0) return true;
		const host = req.headers.host;
		if (typeof host !== "string" || host.length === 0) return false;
		try { return new URL(origin).host === host; } catch { return false; }
	};
	const sendJson = (res, status, body) => {
		const payload = JSON.stringify(body);
		res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
		res.end(payload);
	};
	const route = (path, method, run) => ctx.webServer.register({
		kind: "exact",
		path,
		handler: async (req, res) => {
			try {
				if (!originAllowed(req)) { sendJson(res, 403, { ok: false, error: "forbidden origin" }); return; }
				if ((req.method ?? "GET").toUpperCase() !== method) { sendJson(res, 405, { ok: false, error: "method not allowed" }); return; }
				sendJson(res, 200, { ok: true, ...(await run(req)) });
			} catch (error) {
				ctx.logger.warn("[dsh-qwen-reasoning] request handler failed");
				ctx.logger.warn(safeMessage(error));
				sendJson(res, 500, { ok: false, error: safeMessage(error) });
			}
		}
	});

	const configSnapshot = () => {
		const cfg = readConfig();
		return { autoApply: cfg.autoApply, providerMatch: cfg.providerMatch, modelMatch: cfg.modelMatch, defaultEffort: cfg.defaultEffort, efforts: cfg.efforts };
	};

	ctx.effect(() => {
		const disposers = [
			route("/dsh-qwen-reasoning/status", "GET", async () => statusView()),
			route("/dsh-qwen-reasoning/apply", "POST", async () => await applyNow())
		];
		return () => { for (const dispose of disposers) dispose(); };
	}, "dsh-qwen-reasoning: host routes");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: "/dsh-qwen-reasoning/config",
		handler: async (req, res) => {
			if (!originAllowed(req)) { sendJson(res, 403, { ok: false, error: "forbidden origin" }); return; }
			const method = (req.method ?? "GET").toUpperCase();
			try {
				if (method === "GET") { sendJson(res, 200, { ok: true, ...configSnapshot() }); return; }
				if (method !== "POST") { sendJson(res, 405, { ok: false, error: "method not allowed" }); return; }
				const raw = await readBody(req);
				let parsed;
				try { parsed = JSON.parse(raw || "{}"); } catch { throw new Error("config body is not JSON"); }
				const patch = {};
				if (parsed.autoApply !== undefined) patch.autoApply = Boolean(parsed.autoApply);
				for (const key of ["providerMatch", "modelMatch", "defaultEffort"]) {
					if (parsed[key] !== undefined) {
						if (typeof parsed[key] !== "string") throw new Error(`${key} must be a string`);
						patch[key] = parsed[key].trim();
					}
				}
				if (patch.defaultEffort !== undefined && patch.defaultEffort !== "" && !LEVELS.includes(patch.defaultEffort)) {
					throw new Error(`defaultEffort must be one of ${LEVELS.join("/")}`);
				}
				if (parsed.efforts !== undefined) {
					if (parsed.efforts === null || typeof parsed.efforts !== "object" || Array.isArray(parsed.efforts)) throw new Error("efforts must be an object");
					patch.efforts = parsed.efforts;
				}
				await updateOwnConfig(patch);
				await sync();
				sendJson(res, 200, { ok: true, ...configSnapshot(), ...(await applyNow()) });
			} catch (error) {
				ctx.logger.warn("[dsh-qwen-reasoning] config handler failed");
				ctx.logger.warn(safeMessage(error));
				sendJson(res, 400, { ok: false, error: safeMessage(error) });
			}
		}
	}), "dsh-qwen-reasoning: configuration route");

	// ── self-host the browser bundle + inject its boot graph row ──
	const bundlePath = new URL("./client.js", import.meta.url);
	let bundleBytes = null;
	try { bundleBytes = readFileSync(bundlePath); } catch { /* card unavailable */ }
	if (bundleBytes !== null) {
		const rev = shortHash(bundleBytes);
		ctx.effect(() => ctx.webServer.register({
			kind: "exact",
			path: "/dsh-qwen-reasoning/client.js",
			handler: async (_req, res) => {
				res.setHeader("content-type", "text/javascript; charset=utf-8");
				res.setHeader("cache-control", "no-cache");
				res.end(bundleBytes);
			}
		}), "dsh-qwen-reasoning: client bundle route");
		ctx.effect(() => ctx.webServer.tapIndex((html) => injectGraphRow(html, {
			id: "dsh-qwen-reasoning",
			url: `/dsh-qwen-reasoning/client.js?rev=${rev}`,
			rev,
			inject: ["@deepseek-ai/dsh-client-runtime"],
			immediately: true
		})), "dsh-qwen-reasoning: client boot graph");
	}

	// ── chat command ──
	ctx.effect(() => ctx.commands.register({
		name: "qwen-reasoning",
		description: "apply/show Qwen reasoning-effort levels (off…max) on your qwen providers",
		handler: async () => {
			try {
				const result = await applyNow();
				return { kind: "success", text: renderStatusText(result, readConfig().locale) };
			} catch (error) {
				return { kind: "error", text: safeMessage(error) };
			}
		}
	}), "dsh-qwen-reasoning: command");
}
