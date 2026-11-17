import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReasoningOps, summarizeProviders, matchModel, DEFAULT_EFFORTS } from "../lib/reasoning.js";

const qwenProvider = () => ({
	"qwen-token": {
		displayName: "qwen-token",
		apiKeyEnv: "QWEN_TOKEN_API_KEY",
		api: "openai-completions",
		baseURL: "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1",
		models: [
			{ id: "qwen4-max-preview", name: "qwen4-max-preview", contextWindow: 1024000, maxTokens: 320000, input: ["text", "image"] },
			{ id: "qwen4-max", name: "qwen4-max", contextWindow: 1024000, maxTokens: 320000, input: ["text", "image"] }
		]
	}
});

test("adds the seven levels to qwen models lacking reasoningEfforts", () => {
	const { ops, report } = buildReasoningOps(qwenProvider());
	const modelsOp = ops.find((o) => o.path.join(".") === "providers.qwen-token.models");
	assert.ok(modelsOp, "models op present");
	for (const m of modelsOp.value) {
		assert.deepEqual(m.reasoningEfforts, { ...DEFAULT_EFFORTS });
		assert.equal(m.contextWindow, 1024000); // other fields preserved
		assert.equal(m.maxTokens, 320000);
	}
	assert.equal(report.filter((r) => r.action === "add-efforts").length, 2);
});

test("sets provider reasoning default and compat when missing", () => {
	const { ops } = buildReasoningOps(qwenProvider());
	const reasoning = ops.find((o) => o.path.join(".") === "providers.qwen-token.reasoning");
	const compat = ops.find((o) => o.path.join(".") === "providers.qwen-token.compat");
	assert.equal(reasoning.value, "max");
	assert.equal(compat.value.supportsReasoningEffort, true);
});

test("idempotent: enhancing an already-enhanced provider yields no ops", () => {
	const providers = qwenProvider();
	const first = buildReasoningOps(providers);
	// apply ops to a deep clone of the full config root ({providers: ...})
	const root = { providers: structuredClone(providers) };
	for (const op of first.ops) {
		let node = root;
		for (const key of op.path.slice(0, -1)) node = node[key];
		node[op.path.at(-1)] = op.value;
	}
	const second = buildReasoningOps(root.providers);
	assert.equal(second.ops.length, 0);
	assert.equal(second.report.length, 0);
});

test("respects an explicit reasoningEfforts:false (non-reasoning model)", () => {
	const providers = qwenProvider();
	providers["qwen-token"].models[0].reasoningEfforts = false;
	const { ops } = buildReasoningOps(providers);
	const modelsOp = ops.find((o) => o.path.join(".") === "providers.qwen-token.models");
	assert.equal(modelsOp.value[0].reasoningEfforts, false); // untouched
	assert.deepEqual(modelsOp.value[1].reasoningEfforts, { ...DEFAULT_EFFORTS }); // second still enhanced
});

test("respects an existing custom reasoningEfforts map", () => {
	const providers = qwenProvider();
	providers["qwen-token"].models[0].reasoningEfforts = { off: null, high: "high" };
	const { ops } = buildReasoningOps(providers);
	const modelsOp = ops.find((o) => o.path.join(".") === "providers.qwen-token.models");
	assert.deepEqual(modelsOp.value[0].reasoningEfforts, { off: null, high: "high" });
});

test("does not override existing provider reasoning / compat", () => {
	const providers = qwenProvider();
	providers["qwen-token"].reasoning = "high";
	providers["qwen-token"].compat = { supportsReasoningEffort: true, maxTokensField: "max_tokens" };
	const { ops } = buildReasoningOps(providers);
	assert.equal(ops.find((o) => o.path.at(-1) === "reasoning"), undefined);
	assert.equal(ops.find((o) => o.path.at(-1) === "compat"), undefined);
});

test("leaves non-qwen models and other providers untouched", () => {
	const providers = qwenProvider();
	providers["qwen-token"].models.push({ id: "glm-5.3", name: "glm-5.3" });
	providers.opencode2 = { models: [{ id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash" }], reasoning: "max" };
	const { ops } = buildReasoningOps(providers);
	assert.ok(ops.every((o) => o.path[1] === "qwen-token"), "only qwen-token provider touched");
	const modelsOp = ops.find((o) => o.path.join(".") === "providers.qwen-token.models");
	assert.equal(modelsOp.value.find((m) => m.id === "glm-5.3").reasoningEfforts, undefined);
});

test("providerMatch filter restricts which providers are enhanced", () => {
	const providers = qwenProvider();
	providers["other-qwen"] = { models: [{ id: "qwen3-max", name: "qwen3-max" }] };
	const { ops } = buildReasoningOps(providers, { providerMatch: "^qwen-token$" });
	assert.ok(ops.every((o) => o.path[1] === "qwen-token"));
});

test("custom efforts map and modelMatch are honored", () => {
	const providers = { p: { models: [{ id: "qwen4-max" }, { id: "qwen3-max" }] } };
	const { ops } = buildReasoningOps(providers, { modelMatch: "qwen4", efforts: { off: "none", high: "high", max: "max" }, defaultEffort: "high" });
	const modelsOp = ops.find((o) => o.path.join(".") === "providers.p.models");
	assert.deepEqual(modelsOp.value[0].reasoningEfforts, { off: "none", high: "high", max: "max" });
	assert.equal(modelsOp.value[1].reasoningEfforts, undefined);
	assert.equal(ops.find((o) => o.path.at(-1) === "reasoning").value, "high");
});

test("matchModel: regex, empty pattern, invalid regex fallback", () => {
	assert.equal(matchModel("qwen4-max", "qwen"), true);
	assert.equal(matchModel("QWEN4-MAX", "qwen4"), true);
	assert.equal(matchModel("glm-5.3", "qwen"), false);
	assert.equal(matchModel("anything", ""), true);
	assert.equal(matchModel("qwen4-max[beta]", "[beta"), true); // invalid regex → substring fallback matches
	assert.equal(matchModel("qwen4-max", "[invalid"), false); // invalid regex → no throw, substring absent
	assert.equal(matchModel(123, "qwen"), false);
});

test("summarizeProviders reports matched models and their state", () => {
	const providers = qwenProvider();
	providers["qwen-token"].models[0].reasoningEfforts = { ...DEFAULT_EFFORTS };
	const rows = summarizeProviders(providers);
	assert.equal(rows.length, 2);
	assert.equal(rows[0].hasEfforts, true);
	assert.equal(rows[1].hasEfforts, false);
});

test("empty / malformed providers produce no ops", () => {
	assert.equal(buildReasoningOps(undefined).ops.length, 0);
	assert.equal(buildReasoningOps({}).ops.length, 0);
	assert.equal(buildReasoningOps({ p: null }).ops.length, 0);
	assert.equal(buildReasoningOps({ p: { models: "nope" } }).ops.length, 0);
});
