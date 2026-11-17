import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";

// Mock cordis context exercising the host's auto-sync wiring (startup retry,
// settings/document-updated event, periodic safety poll) against the real
// apply() + buildReasoningOps + settings.mutate path. Timers are mocked so the
// 250ms debounce / 15s poll are deterministic.

const flush = () => new Promise((resolve) => process.nextTick(resolve));

function applySet(providers, path, value) {
	// path is ["providers", pid, field, ...]; walk into the providers dict.
	const keys = path.slice(1);
	let obj = providers;
	for (let i = 0; i < keys.length - 1; i++) {
		if (obj[keys[i]] === undefined || obj[keys[i]] === null) obj[keys[i]] = {};
		obj = obj[keys[i]];
	}
	obj[keys[keys.length - 1]] = value;
}

function makeCtx(providers) {
	const state = { providers, revision: 0, mutateCalls: [], listeners: {}, disposers: [] };
	const ctx = {
		settings: {
			configure: () => () => {},
			describe: () => [{ ns: "llm-pi-ai", value: { providers: state.providers }, revision: state.revision }],
			mutate: async (ns, ops, rev) => {
				state.mutateCalls.push({ ns, ops, rev });
				for (const op of ops) if (op.op === "set") applySet(state.providers, op.path, op.value);
				state.revision++;
			}
		},
		get: (name) => (name === "configEditor" ? { entries: () => [] } : undefined),
		fiber: { entry: { options: { id: "dsh-qwen-reasoning" } } },
		effect: (fn) => { const d = fn(); if (typeof d === "function") state.disposers.push(d); return d; },
		on: (name, listener) => { (state.listeners[name] ||= []).push(listener); return () => {}; },
		logger: { info: () => {}, warn: () => {} },
		commands: { register: () => () => {} },
		webServer: { register: () => () => {}, tapIndex: () => () => {} }
	};
	return { ctx, state };
}

const freshProviders = () => ({
	qwentest: { models: [{ id: "qwen-x", name: "qwen-x" }], compat: {} },
	other: { models: [{ id: "deepseek-y" }] }
});

test("startup sync enhances matching qwen models", async () => {
	mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	try {
		const { ctx, state } = makeCtx(freshProviders());
		apply(ctx, {});
		await flush();
		assert.ok(state.mutateCalls.length >= 1, "startup should write");
		assert.ok(state.providers.qwentest.models[0].reasoningEfforts, "qwen model gains levels");
		assert.equal(state.providers.qwentest.reasoning, "max");
		assert.equal(state.providers.qwentest.compat.supportsReasoningEffort, true);
		assert.equal(state.providers.other.models[0].reasoningEfforts, undefined, "non-qwen untouched");
		for (const d of state.disposers) d();
	} finally { mock.timers.reset(); }
});

test("settings/document-updated event re-enhances after an external removal", async () => {
	mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	try {
		const { ctx, state } = makeCtx(freshProviders());
		apply(ctx, {});
		await flush();
		const before = state.mutateCalls.length;
		// simulate an external config edit removing the map
		delete state.providers.qwentest.models[0].reasoningEfforts;
		state.revision++;
		for (const fn of state.listeners["settings/document-updated"] || []) fn("llm-pi-ai", state.revision);
		mock.timers.tick(300); // past the 250ms debounce
		await flush();
		assert.ok(state.mutateCalls.length > before, "event triggers a write");
		assert.ok(state.providers.qwentest.models[0].reasoningEfforts, "map restored by event sync");
		for (const d of state.disposers) d();
	} finally { mock.timers.reset(); }
});

test("periodic safety poll re-enhances even without an event", async () => {
	mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	try {
		const { ctx, state } = makeCtx(freshProviders());
		apply(ctx, {});
		await flush();
		// drain the startup ladder so only the poll remains relevant
		mock.timers.tick(9000);
		await flush();
		const before = state.mutateCalls.length;
		delete state.providers.qwentest.models[0].reasoningEfforts;
		state.revision++;
		// no event fired — only the 15s poll can recover this
		mock.timers.tick(15000);
		await flush();
		assert.ok(state.mutateCalls.length > before, "poll triggers a write");
		assert.ok(state.providers.qwenst?.models?.[0]?.reasoningEfforts ?? state.providers.qwentest.models[0].reasoningEfforts, "map restored by poll");
		for (const d of state.disposers) d();
	} finally { mock.timers.reset(); }
});

test("autoApply:false disables automatic writes", async () => {
	mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	try {
		const { ctx, state } = makeCtx(freshProviders());
		apply(ctx, { autoApply: false });
		await flush();
		mock.timers.tick(16000);
		await flush();
		assert.equal(state.mutateCalls.length, 0, "no automatic writes when autoApply is off");
		assert.equal(state.providers.qwentest.models[0].reasoningEfforts, undefined);
		for (const d of state.disposers) d();
	} finally { mock.timers.reset(); }
});
