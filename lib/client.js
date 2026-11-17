// dsh-qwen-reasoning — browser half.
//
// Hand-authored client bundle in the DSH module-loader factory format
// (`window.__ModuleLoader__.load({ id, factory })`). It registers a configuration
// card into the Plugin Manager / Settings slots. The card shows which Qwen models
// have reasoning levels, lets the user apply the enhancement now, and tune the
// match pattern / default effort. Everything talks to the host's same-origin
// routes. UI strings are bilingual via the DSH locale service.
window.__ModuleLoader__.load({
	id: "dsh-qwen-reasoning",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");

		const NS = "dsh-qwen-reasoning";
		const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

		// ── styles (injected once; themed alias tokens, light/dark safe) ──
		const CSS_ID = "dsh-qwen-reasoning/card.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + CSS_ID + "\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-qwen-reasoning";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				".qr-config{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:12px;margin:0;list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;color:var(--dsw-alias-label-primary)}",
				".qr-title{font-size:14px;line-height:20px;font-weight:600}",
				".qr-desc,.qr-note,.qr-status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
				".qr-status.qr-ok{color:var(--dsw-alias-state-success-primary)}",
				".qr-status.qr-error{color:var(--dsw-alias-state-error-primary)}",
				".qr-models{display:flex;flex-direction:column;gap:4px}",
				".qr-model{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;line-height:18px}",
				".qr-model-name{color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
				".qr-badge{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);flex:none}",
				".qr-badge.qr-ok{color:var(--dsw-alias-state-success-primary);border-color:currentColor}",
				".qr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}",
				".qr-field{display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}",
				".qr-field input,.qr-field select{box-sizing:border-box;width:100%;min-height:30px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-primary);font:inherit}",
				".qr-check{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer}",
				".qr-check input{width:16px;height:16px;accent-color:var(--dsw-alias-button-primary-fill)}",
				".qr-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
				".qr-save{min-height:30px;padding:4px 12px;border:none;border-radius:6px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font:inherit;cursor:pointer}",
				".qr-save:disabled{opacity:.45;cursor:default}",
				".qr-secondary{min-height:30px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}",
				".qr-secondary:disabled{opacity:.45;cursor:default}"
			].join("");
			document.head.appendChild(tag);
		}

		// ── locale dictionaries ──
		const zh = {
			"config.title": "Qwen 推理档位",
			"config.summary": "为你的 qwen 模型启用完整推理档位（off/minimal/low/medium/high/xhigh/max），并把提供商默认设为 max。加法写入，保留你已有的配置。",
			"config.loading": "正在读取…",
			"config.models": "匹配的模型",
			"config.noModels": "没有匹配的 qwen 模型（检查模型匹配规则）。",
			"config.notReady": "llm-pi-ai 尚未就绪。",
			"config.hasEfforts": "已有档位",
			"config.noEfforts": "无档位",
			"config.default": "默认 {level}",
			"config.apply": "立即应用",
			"config.applying": "应用中…",
			"config.applied": "已写入 {n} 项设置。",
			"config.upToDate": "已是最新，无需写入。",
			"config.autoApply": "自动应用（配置变化时自动增强）",
			"config.modelMatch": "模型匹配（正则，不区分大小写）",
			"config.providerMatch": "提供商匹配（正则，留空=全部）",
			"config.defaultEffort": "默认推理档位",
			"config.save": "保存设置",
			"config.saving": "保存中…",
			"config.saved": "已保存。",
			"config.failed": "失败：{msg}"
		};
		const en = {
			"config.title": "Qwen reasoning levels",
			"config.summary": "Enable the full reasoning-effort set (off/minimal/low/medium/high/xhigh/max) on your qwen models and default the provider to max. Additive — your existing choices are preserved.",
			"config.loading": "Loading…",
			"config.models": "Matched models",
			"config.noModels": "No matching qwen models (check the model match pattern).",
			"config.notReady": "llm-pi-ai is not ready yet.",
			"config.hasEfforts": "levels set",
			"config.noEfforts": "no levels",
			"config.default": "default {level}",
			"config.apply": "Apply now",
			"config.applying": "Applying…",
			"config.applied": "Wrote {n} setting(s).",
			"config.upToDate": "Already up to date, nothing to write.",
			"config.autoApply": "Auto-apply (enhance on config changes)",
			"config.modelMatch": "Model match (regex, case-insensitive)",
			"config.providerMatch": "Provider match (regex, empty = all)",
			"config.defaultEffort": "Default reasoning effort",
			"config.save": "Save settings",
			"config.saving": "Saving…",
			"config.saved": "Saved.",
			"config.failed": "Failed: {msg}"
		};

		function requestJson(url, init) {
			return fetch(url, { cache: "no-store", credentials: "same-origin", ...init })
				.then((res) => res.json().catch(() => null).then((json) => ({ res, json })))
				.catch((error) => ({ res: { ok: false, status: 0 }, json: { ok: false, error: String((error && error.message) || error) } }));
		}

		// ── configuration card ──
		function ConfigCard(props) {
			const t = (props && props.t) || ((key) => key);
			const [draft, setDraft] = react.useState(null);
			const [status, setStatus] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [line, setLine] = react.useState(null);

			const applySnapshot = (json) => {
				setDraft({
					autoApply: json.autoApply !== false,
					providerMatch: json.providerMatch || "",
					modelMatch: json.modelMatch || "qwen",
					defaultEffort: json.defaultEffort || "max"
				});
			};
			const refreshStatus = async () => {
				const { json } = await requestJson("/dsh-qwen-reasoning/status");
				if (json && json.ok === true) setStatus(json);
			};

			react.useEffect(() => {
				let alive = true;
				requestJson("/dsh-qwen-reasoning/config").then(({ res, json }) => {
					if (!alive) return;
					if (json && json.ok === true) applySnapshot(json);
					else setLine({ ok: false, text: t("config.failed", { msg: String((json && json.error) || "HTTP " + res.status) }) });
				});
				refreshStatus();
				return () => { alive = false; };
			}, []);

			const setField = (name, value) => setDraft((current) => current === null ? current : { ...current, [name]: value });

			const applyNow = async () => {
				if (busy) return;
				setBusy(true); setLine(null);
				try {
					const { res, json } = await requestJson("/dsh-qwen-reasoning/apply", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
					if (!json || json.ok !== true) { setLine({ ok: false, text: t("config.failed", { msg: String((json && json.error) || "HTTP " + res.status) }) }); return; }
					setStatus(json);
					setLine({ ok: true, text: json.applied ? t("config.applied", { n: json.ops }) : t("config.upToDate") });
				} finally { setBusy(false); }
			};

			const saveSettings = async () => {
				if (draft === null || busy) return;
				setBusy(true); setLine(null);
				try {
					const { res, json } = await requestJson("/dsh-qwen-reasoning/config", {
						method: "POST", headers: { "content-type": "application/json" },
						body: JSON.stringify({
							autoApply: draft.autoApply,
							providerMatch: draft.providerMatch.trim(),
							modelMatch: draft.modelMatch.trim(),
							defaultEffort: draft.defaultEffort
						})
					});
					if (!json || json.ok !== true) { setLine({ ok: false, text: t("config.failed", { msg: String((json && json.error) || "HTTP " + res.status) }) }); return; }
					applySnapshot(json);
					setStatus(json);
					setLine({ ok: true, text: t("config.saved") });
				} finally { setBusy(false); }
			};

			if (draft === null) {
				return react_jsx_runtime.jsx("li", {
					className: "qr-config",
					children: [
						react_jsx_runtime.jsx("div", { className: "qr-title", children: t("config.title") }),
						react_jsx_runtime.jsx("div", { className: "qr-desc", children: t("config.loading") })
					]
				});
			}

			const models = status && Array.isArray(status.models) ? status.models : [];
			const modelRows = models.map((m, i) => react_jsx_runtime.jsx("div", {
				className: "qr-model",
				children: [
					react_jsx_runtime.jsx("span", { className: "qr-model-name", children: m.provider + "/" + m.model + (m.reasoning ? " · " + t("config.default", { level: m.reasoning }) : "") }),
					react_jsx_runtime.jsx("span", { className: "qr-badge " + (m.hasEfforts ? "qr-ok" : ""), children: m.hasEfforts ? t("config.hasEfforts") : t("config.noEfforts") })
				]
			}, "m" + i));

			const textField = (name, labelKey) => react_jsx_runtime.jsx("label", {
				className: "qr-field",
				children: [
					t(labelKey),
					react_jsx_runtime.jsx("input", {
						type: "text", "aria-label": t(labelKey), value: draft[name],
						onChange: (event) => setField(name, event.target.value), disabled: busy
					})
				]
			}, name);

			return react_jsx_runtime.jsx("li", {
				className: "qr-config",
				children: [
					react_jsx_runtime.jsx("div", { className: "qr-title", children: t("config.title") }),
					react_jsx_runtime.jsx("div", { className: "qr-desc", children: t("config.summary") }),
					react_jsx_runtime.jsx("div", { className: "qr-note", children: t("config.models") }),
					status === null ? react_jsx_runtime.jsx("div", { className: "qr-desc", children: t("config.loading") })
						: status.ready === false ? react_jsx_runtime.jsx("div", { className: "qr-desc", children: t("config.notReady") })
						: models.length === 0 ? react_jsx_runtime.jsx("div", { className: "qr-desc", children: t("config.noModels") })
						: react_jsx_runtime.jsx("div", { className: "qr-models", children: modelRows }),
					react_jsx_runtime.jsx("div", {
						className: "qr-actions",
						children: react_jsx_runtime.jsx("button", { className: "qr-save", onClick: applyNow, disabled: busy, children: busy ? t("config.applying") : t("config.apply") })
					}),
					react_jsx_runtime.jsx("label", {
						className: "qr-check",
						children: [
							react_jsx_runtime.jsx("input", { type: "checkbox", checked: draft.autoApply, onChange: (event) => setField("autoApply", event.target.checked), disabled: busy }),
							t("config.autoApply")
						]
					}),
					react_jsx_runtime.jsx("div", {
						className: "qr-grid",
						children: [
							textField("modelMatch", "config.modelMatch"),
							textField("providerMatch", "config.providerMatch"),
							react_jsx_runtime.jsx("label", {
								className: "qr-field",
								children: [
									t("config.defaultEffort"),
									react_jsx_runtime.jsx("select", {
										"aria-label": t("config.defaultEffort"), value: draft.defaultEffort,
										onChange: (event) => setField("defaultEffort", event.target.value), disabled: busy,
										children: LEVELS.map((level) => react_jsx_runtime.jsx("option", { value: level, children: level }, level))
									})
								]
							}, "defaultEffort")
						]
					}),
					react_jsx_runtime.jsx("div", {
						className: "qr-actions",
						children: react_jsx_runtime.jsx("button", { className: "qr-secondary", onClick: saveSettings, disabled: busy, children: busy ? t("config.saving") : t("config.save") })
					}),
					line ? react_jsx_runtime.jsx("div", { className: "qr-status " + (line.ok ? "qr-ok" : "qr-error"), children: line.text }) : null
				]
			});
		}

		// ── cordis plugin entry ──
		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-qwen-reasoning: dictionaries");
			const fallback = (key) => zh[key] || key;
			const bound = typeof ctx.locale.bind === "function" ? ctx.locale.bind(NS) : fallback;
			const renderConfig = (props) => {
				const translate = typeof props?.t === "function" ? props.t : bound;
				if (props?.view === "summary") return translate("config.summary");
				return ConfigCard({ ...(props || {}), t: translate });
			};
			const registerConfig = (slot, options, label) => {
				const register = () => ctx.slots.register({ name: slot, ...options }, renderConfig);
				if (typeof ctx.slots.inject === "function") {
					ctx.effect(() => ctx.slots.inject(slot, register), label);
				} else {
					ctx.effect(register, label);
				}
			};
			registerConfig("settings.plugin.item", { key: NS }, "dsh-qwen-reasoning: legacy configuration card");
			registerConfig("plugins.bundle.config", { key: NS, locale: NS }, "dsh-qwen-reasoning: bundle configuration card");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
