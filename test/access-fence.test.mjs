import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";

// Mock cordis context capturing webServer routes so the connection access
// fence (ctx.connection.requestRejection) can be exercised per handler.

const flush = () => new Promise((resolve) => process.nextTick(resolve));

function makeCtx(providers) {
	const state = { routes: new Map(), rejection: undefined, disposers: [], mutateCalls: 0 };
	const ctx = {
		settings: {
			configure: () => () => {},
			describe: () => [{ ns: "llm-pi-ai", value: { providers }, revision: 0 }],
			mutate: async () => { state.mutateCalls++; }
		},
		connection: { requestRejection: () => state.rejection },
		get: () => undefined,
		fiber: { entry: { options: { id: "dsh-qwen-reasoning" } } },
		effect: (fn) => { const d = fn(); if (typeof d === "function") state.disposers.push(d); return d; },
		on: () => () => {},
		logger: { info: () => {}, warn: () => {} },
		commands: { register: () => () => {} },
		webServer: {
			register: (route) => { state.routes.set(route.path, route.handler); return () => {}; },
			tapIndex: () => () => {}
		}
	};
	return { ctx, state };
}

function makeRes() {
	return {
		status: 0,
		body: "",
		writeHead(status) { this.status = status; },
		setHeader() {},
		end(body) { this.body = body ?? ""; }
	};
}

const request = (path, method) => ({ method, url: path, headers: {} });

test("every route is refused with 401/403 before doing any work", async () => {
	const { ctx, state } = makeCtx({ qwentest: { models: [{ id: "qwen-x" }], compat: {} } });
	apply(ctx, { autoApply: false });
	await flush();
	const expected = [
		["/dsh-qwen-reasoning/status", "GET"],
		["/dsh-qwen-reasoning/apply", "POST"],
		["/dsh-qwen-reasoning/config", "GET"],
		["/dsh-qwen-reasoning/config", "POST"],
		["/dsh-qwen-reasoning/client.js", "GET"]
	];
	assert.equal(state.routes.size, 4);
	for (const refusal of [401, 403]) {
		state.rejection = refusal;
		for (const [path, method] of expected) {
			const res = makeRes();
			await state.routes.get(path)(request(path, method), res);
			assert.equal(res.status, refusal, `${method} ${path} must answer ${refusal}`);
			assert.equal(JSON.parse(res.body).ok, false);
		}
	}
	assert.equal(state.mutateCalls, 0, "refused apply must not write settings");
	for (const d of state.disposers) d();
});

test("admitted requests still reach the handlers", async () => {
	const { ctx, state } = makeCtx({ qwentest: { models: [{ id: "qwen-x" }], compat: {} } });
	apply(ctx, {});
	await flush();
	state.rejection = undefined;
	const status = makeRes();
	await state.routes.get("/dsh-qwen-reasoning/status")(request("/dsh-qwen-reasoning/status", "GET"), status);
	assert.equal(status.status, 200);
	assert.equal(JSON.parse(status.body).ok, true);
	const bundle = makeRes();
	await state.routes.get("/dsh-qwen-reasoning/client.js")(request("/dsh-qwen-reasoning/client.js", "GET"), bundle);
	assert.ok(bundle.body.length > 0, "client bundle served when admitted");
	for (const d of state.disposers) d();
});
