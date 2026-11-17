// @ts-check
/**
 * dsh-qwen-reasoning — pure, dependency-free enhancement logic.
 *
 * Builds additive `settings.mutate` ops that give Qwen models the full set of
 * reasoning-effort levels (off/minimal/low/medium/high/xhigh/max) without
 * touching anything else in the user's llm-pi-ai provider configuration.
 *
 * Additive + idempotent: a model that already declares `reasoningEfforts`
 * (including an explicit `false`) is left exactly as the user set it; a provider
 * that already has a `reasoning` default or `compat.supportsReasoningEffort`
 * keeps them. Running twice produces no ops the second time.
 */

/** The seven Qwen4 reasoning levels and their wire spellings. `off` maps to
 * `none` because Qwen enables thinking by default — only an explicit `none`
 * turns it off. */
export const DEFAULT_EFFORTS = Object.freeze({
	off: "none",
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max"
});

export const DEFAULT_CONFIG = Object.freeze({
	autoApply: true,
	providerMatch: "",
	modelMatch: "qwen",
	defaultEffort: "max",
	efforts: DEFAULT_EFFORTS
});

const isObj = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Case-insensitive regex match; an empty pattern matches everything. An invalid
 * regex degrades to a substring match rather than throwing. */
export function matchModel(id, pattern) {
	if (typeof id !== "string") return false;
	if (typeof pattern !== "string" || pattern.length === 0) return true;
	try {
		return new RegExp(pattern, "i").test(id);
	} catch {
		return id.toLowerCase().includes(pattern.toLowerCase());
	}
}

/**
 * @param {Record<string, any>} providers  current llm-pi-ai `providers` dict
 * @param {Partial<typeof DEFAULT_CONFIG>} [config]
 * @returns {{ops: Array<{op:"set",path:string[],value:any}>, report: Array<Record<string,any>>}}
 */
export function buildReasoningOps(providers, config = {}) {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	const efforts = isObj(cfg.efforts) && Object.keys(cfg.efforts).length > 0 ? cfg.efforts : DEFAULT_EFFORTS;
	/** @type {Array<{op:"set",path:string[],value:any}>} */
	const ops = [];
	/** @type {Array<Record<string,any>>} */
	const report = [];
	if (!isObj(providers)) return { ops, report };

	for (const [pid, profile] of Object.entries(providers)) {
		if (!isObj(profile)) continue;
		if (cfg.providerMatch && !matchModel(pid, cfg.providerMatch)) continue;
		const models = Array.isArray(profile.models) ? profile.models : [];
		let changed = false;
		const nextModels = models.map((model) => {
			if (!isObj(model) || !matchModel(model.id, cfg.modelMatch)) return model;
			if (model.reasoningEfforts !== undefined) return model; // respect explicit choice (incl. false)
			changed = true;
			report.push({ provider: pid, model: model.id, action: "add-efforts" });
			return { ...model, reasoningEfforts: { ...efforts } };
		});
		if (!changed) continue; // nothing to enhance in this provider

		ops.push({ op: "set", path: ["providers", pid, "models"], value: nextModels });

		if (profile.reasoning === undefined && cfg.defaultEffort) {
			ops.push({ op: "set", path: ["providers", pid, "reasoning"], value: cfg.defaultEffort });
			report.push({ provider: pid, action: "set-default", effort: cfg.defaultEffort });
		}
		const compat = isObj(profile.compat) ? profile.compat : {};
		if (compat.supportsReasoningEffort !== true) {
			ops.push({ op: "set", path: ["providers", pid, "compat"], value: { ...compat, supportsReasoningEffort: true } });
			report.push({ provider: pid, action: "enable-compat" });
		}
	}
	return { ops, report };
}

/** Status view: which matched models exist and whether they already have levels. */
export function summarizeProviders(providers, config = {}) {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	const out = [];
	if (!isObj(providers)) return out;
	for (const [pid, profile] of Object.entries(providers)) {
		if (!isObj(profile)) continue;
		if (cfg.providerMatch && !matchModel(pid, cfg.providerMatch)) continue;
		const models = Array.isArray(profile.models) ? profile.models : [];
		for (const model of models) {
			if (!isObj(model) || !matchModel(model.id, cfg.modelMatch)) continue;
			out.push({
				provider: pid,
				model: model.id,
				hasEfforts: model.reasoningEfforts !== undefined && model.reasoningEfforts !== false,
				reasoning: profile.reasoning ?? null,
				supportsReasoningEffort: isObj(profile.compat) ? profile.compat.supportsReasoningEffort === true : false
			});
		}
	}
	return out;
}
