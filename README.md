# dsh-qwen-reasoning

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) plugin that gives your **Qwen** models the full set of reasoning-effort levels — `off / minimal / low / medium / high / xhigh / max` — and defaults the provider to `max`, so the DSH reasoning bar exposes every level and `reasoning_effort` is actually sent to the Qwen gateway.

为你的 qwen 模型启用完整推理档位（off/minimal/low/medium/high/xhigh/max），并把提供商默认设为 `max`，让 DSH 推理条显示全部档位、并真正向千问网关发送 `reasoning_effort`。

---

## Why this exists / 为什么需要它

Qwen models served through an OpenAI-compatible gateway (e.g. the Qwen AI Platform Token Plan endpoint `https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1`) **think by default**, but a hand-declared model in DSH's `llm-pi-ai` provider has no `reasoningEfforts` map, so:

- the reasoning bar shows no selectable levels, and
- DSH never sends `reasoning_effort`, leaving you stuck at the gateway default.

This plugin fixes that declaratively. The Qwen gateway accepts `reasoning_effort ∈ {none, off, minimal, low, medium, high, xhigh, max}` (verified live: an invalid value returns `400` listing exactly these). `max` is the highest; `none` turns thinking off.

通过 OpenAI 兼容网关接入的 qwen 模型**默认开启思考**，但在 DSH `llm-pi-ai` 里手工声明的模型没有 `reasoningEfforts` 映射，导致推理条无档位可选、DSH 也不发送 `reasoning_effort`。本插件以声明方式补上。千问网关接受 `reasoning_effort ∈ {none, off, minimal, low, medium, high, xhigh, max}`（已实测：非法值返回 400 并列出这八项）；`max` 最高，`none` 关闭思考。

> `off` maps to wire value `none` (not "omit"): because Qwen thinks by default, omitting the field would keep thinking on. `off → none` is what actually disables it.
>
> `off` 映射到 `none`（而非"省略"）：qwen 默认开思考，省略字段会保持思考，`off → none` 才能真正关闭。

## What it does / 它做什么

On install (and whenever your `llm-pi-ai` config changes), the plugin:

1. reads your live providers via `settings.describe()`;
2. for every provider with a matching model (default: model id contains `qwen`), **adds** the seven-level `reasoningEfforts` map to models that lack one;
3. sets the provider's default `reasoning` to `max` and `compat.supportsReasoningEffort: true` when missing;
4. writes the changes back with `settings.mutate()` (the `providers` field is volatile), persisting to your profile patch.

安装后（以及你的 `llm-pi-ai` 配置变化时），插件读取实时提供商，为含匹配模型（默认模型 id 含 `qwen`）的提供商**补上**七档 `reasoningEfforts`，在缺省时设默认 `reasoning: max` 与 `compat.supportsReasoningEffort: true`，再经 `settings.mutate()` 写回你的 profile 补丁。

**Additive + idempotent / 加法且幂等** — it never overwrites an existing `reasoningEfforts` map (including an explicit `false` for non-reasoning models), an existing provider `reasoning`, or existing `compat` choices. A second run writes nothing. Non-matching models and other providers are left untouched.

绝不覆盖已有的 `reasoningEfforts`（含显式 `false` 的非推理模型）、已有的 provider `reasoning` 或 `compat`。再次运行不写入任何内容；不匹配的模型与其他提供商原样保留。

### Why a runtime plugin, not a static config patch / 为什么是运行时插件而非静态配置补丁

A DSH bundle patch replaces the target plugin's config **wholesale** (never deep-merged). A static patch carrying `llm-pi-ai` providers would wipe your own providers. So this plugin does a surgical runtime read‑modify‑write of just the reasoning fields, preserving everything else.

DSH bundle 补丁对目标插件配置是**整段覆盖**（从不深合并）。携带 `llm-pi-ai` 提供商的静态补丁会冲掉你自己的提供商。因此本插件在运行时只针对推理字段做精确的读‑改‑写，其余配置全部保留。

## Install / 安装

```bash
# DSH plugin CLI (recommended)
dsh plugin --profile web add dsh-qwen-reasoning
```

Or install by spec in **Settings → Plugins → Install**:

- npm name: `dsh-qwen-reasoning`
- git: `git:jasocheung/dsh-qwen-reasoning`
- local path: the cloned directory

或在 **设置 → 插件 → 安装** 按规格安装：npm 名 `dsh-qwen-reasoning`、git `git:jasocheung/dsh-qwen-reasoning`、或本地克隆目录。

> After installing, reload the DSH window (Ctrl+R) so the browser bundle mounts. Linked local installs are outside DSH's HMR scope, so **source edits require a host restart** to take effect.
>
> 安装后刷新 DSH 窗口（Ctrl+R）以挂载浏览器 bundle。链接式本地安装不在 DSH HMR 范围内，**改源码需重启 host** 才生效。

## Configuration / 配置

Open **Settings → Plugins → dsh-qwen-reasoning** (the configuration card):

- **Matched models** — each matching `provider/model` with a badge (`levels set` / `no levels`) and its default effort.
- **Apply now** — force the enhancement immediately.
- **Auto-apply** — re-enhance whenever `llm-pi-ai` config changes (default on).
- **Model match** — case-insensitive regex on the model id (default `qwen`).
- **Provider match** — case-insensitive regex on the provider id (default empty = all providers).
- **Default reasoning effort** — one of the seven levels (default `max`).

打开 **设置 → 插件 → dsh-qwen-reasoning** 配置卡：匹配模型列表（已有档位/无档位徽章 + 默认档位）、立即应用、自动应用、模型匹配正则、提供商匹配正则、默认推理档位。

The wire-level `efforts` map is also configurable via the plugin config (`efforts`), defaulting to:

```json
{ "off": "none", "minimal": "minimal", "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max" }
```

## Chat command / 聊天命令

```
/qwen-reasoning
```

Applies the enhancement and prints the matched models, their level state, and how many settings were written.

应用增强并打印匹配模型、档位状态与本次写入项数。

## Routes / 路由（同源）

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/dsh-qwen-reasoning/status` | matched models + level state (read-only) |
| POST | `/dsh-qwen-reasoning/apply` | enhance now (force) |
| GET/POST | `/dsh-qwen-reasoning/config` | plugin configuration |
| GET | `/dsh-qwen-reasoning/client.js` | self-hosted browser bundle |

## Compatibility / 兼容性

- DSH `0.1.7-rc.2` (desktop), Node `>=18`, web + desktop client.
- Pure ESM, prebuilt `lib/` — no build step.
- Requires the `llm-pi-ai` provider plugin (ships with DSH) and a Qwen model declared under it.
- `engines.dsh: ">=0.1.0-rc.1 <0.3.0-0"` (prerelease-aware range).

## Development / 开发

```bash
node --test          # 12 unit tests for the additive/idempotent op builder
node --check lib/index.js
node --check lib/client.js
```

The op builder (`lib/reasoning.js`) is pure and dependency-free; the host (`lib/index.js`) wires it to the DSH settings service. `lib/client.js` is the hand-authored browser bundle (module-loader factory format, theme tokens only).

## Marketplace listing / 市场收录

- **Official discoverability**: the GitHub topic [`dsh-plugin`](https://github.com/topics/dsh-plugin) (the only official plugin discovery channel; DSH has no central registry).
- **awesome-dsh-plugin**: listed via a PR adding `data/plugins/jasocheung__dsh-qwen-reasoning.yml`.
- **dsh-plugin-hub / shop / feed**: index npm packages carrying the `dsh-plugin` keyword + `dsh` bundle metadata.

## License / 许可

[MIT](./LICENSE)
