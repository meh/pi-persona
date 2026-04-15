/**
 * pi-persona extension
 *
 * Provides named personas that modify pi's behavior via system prompt injections
 * and reinforcement messages. Personas are discovered from:
 *   ~/.pi/persona/NAME/   (global)
 *   .pi/persona/NAME/     (project-local, takes priority)
 *
 * Persona directory structure:
 *   SYSTEM.md              alias for post/SYSTEM.md
 *   REINFORCE.md           alias for post/REINFORCE.md
 *   SKILLS.md              appended to system prompt (skill descriptions / guidance)
 *   pre/SYSTEM.md          prepended to system prompt
 *   pre/REINFORCE.md       injected as user message before each user message
 *   pre/N/REINFORCE.md     like pre/REINFORCE.md but only every N turns
 *   post/SYSTEM.md         appended to system prompt
 *   post/REINFORCE.md      injected as user message after each user message
 *   post/N/REINFORCE.md    like post/REINFORCE.md but only every N turns
 *
 * The active persona directory is watched for changes. Any file added, modified,
 * or removed is reflected automatically with a short debounce.
 *
 * Commands:
 *   /persona           show active persona and list available ones
 *   /persona NAME      activate a persona
 *   /persona off       deactivate current persona
 *   /persona list      list available personas
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NReinforce {
	n: number;
	content: string;
}

interface PersonaConfig {
	name: string;
	basePath: string;
	/** Prepended to system prompt */
	preSystem: string | null;
	/** Appended to system prompt */
	postSystem: string | null;
	/** Injected before user message every turn */
	preReinforce: string | null;
	/** Injected after user message every turn */
	postReinforce: string | null;
	/** Injected before user message every N turns */
	preNReinforce: NReinforce[];
	/** Injected after user message every N turns */
	postNReinforce: NReinforce[];
	/** Appended to system prompt (skill descriptions / guidance) */
	skills: string | null;
	/** Absolute paths to tool definition files in tools/ */
	toolFiles: string[];
}

type AnyMessage = { role: string;[key: string]: unknown };

interface MinimalUI {
	notify: (msg: string, type: "info" | "success" | "warning" | "error") => void;
	setStatus: (id: string, text: string | undefined) => void;
}

// ---------------------------------------------------------------------------
// File loading helpers
// ---------------------------------------------------------------------------

function readIfExists(filePath: string): string | null {
	if (fs.existsSync(filePath)) {
		const content = fs.readFileSync(filePath, "utf-8").trim();
		return content.length > 0 ? content : null;
	}
	return null;
}

function scanNDirs(dir: string): NReinforce[] {
	const results: NReinforce[] = [];
	if (!fs.existsSync(dir)) return results;

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		if (!/^\d+$/.test(entry.name)) continue;
		const n = parseInt(entry.name, 10);
		if (n < 1) continue;
		const content = readIfExists(path.join(dir, entry.name, "REINFORCE.md"));
		if (content) results.push({ n, content });
	}

	return results;
}

function loadPersona(basePath: string, name: string): PersonaConfig {
	const preDir = path.join(basePath, "pre");
	const postDir = path.join(basePath, "post");

	const preSystem = readIfExists(path.join(preDir, "SYSTEM.md"));
	// post/SYSTEM.md is canonical; root SYSTEM.md is an alias
	const postSystem =
		readIfExists(path.join(postDir, "SYSTEM.md")) ??
		readIfExists(path.join(basePath, "SYSTEM.md"));

	const preReinforce = readIfExists(path.join(preDir, "REINFORCE.md"));
	// post/REINFORCE.md is canonical; root REINFORCE.md is an alias
	const postReinforce =
		readIfExists(path.join(postDir, "REINFORCE.md")) ??
		readIfExists(path.join(basePath, "REINFORCE.md"));

	const preNReinforce = scanNDirs(preDir);
	const postNReinforce = scanNDirs(postDir);

	const skills = readIfExists(path.join(basePath, "SKILLS.md"));

	const toolsDir = path.join(basePath, "tools");
	const toolFiles: string[] = [];
	if (fs.existsSync(toolsDir)) {
		for (const entry of fs.readdirSync(toolsDir, { withFileTypes: true })) {
			if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
				toolFiles.push(path.join(toolsDir, entry.name));
			}
		}
		toolFiles.sort();
	}

	return {
		name,
		basePath,
		preSystem,
		postSystem,
		preReinforce,
		postReinforce,
		preNReinforce,
		postNReinforce,
		skills,
		toolFiles,
	};
}

// ---------------------------------------------------------------------------
// Persona discovery
// ---------------------------------------------------------------------------

function discoverPersonas(cwd: string): Map<string, string> {
	const personas = new Map<string, string>();
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";

	// Global personas (lower priority)
	const globalDir = path.join(home, ".pi", "persona");
	if (fs.existsSync(globalDir)) {
		for (const entry of fs.readdirSync(globalDir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				personas.set(entry.name, path.join(globalDir, entry.name));
			}
		}
	}

	// Project-local personas (higher priority – override globals)
	const localDir = path.join(cwd, ".pi", "persona");
	if (fs.existsSync(localDir)) {
		for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				personas.set(entry.name, path.join(localDir, entry.name));
			}
		}
	}

	return personas;
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

function makeUserMessage(text: string): AnyMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function countTurns(messages: AnyMessage[]): number {
	return messages.filter((m) => m.role === "assistant").length;
}

function lastUserIndex(messages: AnyMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") return i;
	}
	return -1;
}

// ---------------------------------------------------------------------------
// Diff helpers – used to produce human-readable reload summaries
// ---------------------------------------------------------------------------

function describeChanges(prev: PersonaConfig, next: PersonaConfig): string[] {
	const changes: string[] = [];

	const fields: Array<[string, keyof PersonaConfig]> = [
		["pre/SYSTEM", "preSystem"],
		["post/SYSTEM (SYSTEM)", "postSystem"],
		["pre/REINFORCE", "preReinforce"],
		["post/REINFORCE (REINFORCE)", "postReinforce"],
		["SKILLS", "skills"],
	];

	for (const [label, key] of fields) {
		const p = prev[key] as string | null;
		const n = next[key] as string | null;
		if (p === null && n !== null) changes.push(`+ ${label}`);
		else if (p !== null && n === null) changes.push(`- ${label}`);
		else if (p !== null && n !== null && p !== n) changes.push(`~ ${label}`);
	}

	// N-based reinforcements
	const prevPreN = new Set((prev.preNReinforce).map((r) => r.n));
	const nextPreN = new Set((next.preNReinforce).map((r) => r.n));
	for (const n of nextPreN) {
		if (!prevPreN.has(n)) changes.push(`+ pre/${n}/REINFORCE`);
		else {
			const pContent = prev.preNReinforce.find((r) => r.n === n)?.content;
			const nContent = next.preNReinforce.find((r) => r.n === n)?.content;
			if (pContent !== nContent) changes.push(`~ pre/${n}/REINFORCE`);
		}
	}
	for (const n of prevPreN) {
		if (!nextPreN.has(n)) changes.push(`- pre/${n}/REINFORCE`);
	}

	const prevPostN = new Set((prev.postNReinforce).map((r) => r.n));
	const nextPostN = new Set((next.postNReinforce).map((r) => r.n));
	for (const n of nextPostN) {
		if (!prevPostN.has(n)) changes.push(`+ post/${n}/REINFORCE`);
		else {
			const pContent = prev.postNReinforce.find((r) => r.n === n)?.content;
			const nContent = next.postNReinforce.find((r) => r.n === n)?.content;
			if (pContent !== nContent) changes.push(`~ post/${n}/REINFORCE`);
		}
	}
	for (const n of prevPostN) {
		if (!nextPostN.has(n)) changes.push(`- post/${n}/REINFORCE`);
	}

	// Tool files (additions / removals only; modified files detected by watcher)
	const prevToolNames = new Set(prev.toolFiles.map((f) => path.basename(f)));
	const nextToolNames = new Set(next.toolFiles.map((f) => path.basename(f)));
	for (const f of nextToolNames) {
		if (!prevToolNames.has(f)) changes.push(`+ tools/${f}`);
	}
	for (const f of prevToolNames) {
		if (!nextToolNames.has(f)) changes.push(`- tools/${f}`);
	}

	return changes;
}

// ---------------------------------------------------------------------------
// File watcher
// ---------------------------------------------------------------------------

const DEBOUNCE_MS = 1000;

class PersonaWatcher {
	private watcher: fs.FSWatcher | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingToolsChanged = false;
	private persona: PersonaConfig;
	private onReload: (next: PersonaConfig, changes: string[], toolsChanged: boolean) => void;

	constructor(
		persona: PersonaConfig,
		onReload: (next: PersonaConfig, changes: string[], toolsChanged: boolean) => void,
	) {
		this.persona = persona;
		this.onReload = onReload;
		this.start();
	}

	private start(): void {
		try {
			this.watcher = fs.watch(
				this.persona.basePath,
				{ recursive: true },
				(_event, filename) => {
					const fname = String(filename ?? "");
					if (fname.endsWith(".md")) {
						this.scheduleReload(false);
					} else if (fname.endsWith(".ts") || fname.endsWith(".js")) {
						this.scheduleReload(true);
					}
				},
			);
			this.watcher.on("error", () => this.stop());
		} catch {
			// Watcher unavailable (e.g. path gone); silently ignore
		}
	}

	private scheduleReload(toolsChanged: boolean): void {
		this.pendingToolsChanged = this.pendingToolsChanged || toolsChanged;
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			const toolsChangedSnapshot = this.pendingToolsChanged;
			this.pendingToolsChanged = false;
			const prev = this.persona;
			const next = loadPersona(prev.basePath, prev.name);
			const changes = describeChanges(prev, next);
			this.persona = next;
			this.onReload(next, changes, toolsChangedSnapshot);
		}, DEBOUNCE_MS);
	}

	stop(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
	}
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

type ToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];

export default function personaExtension(pi: ExtensionAPI) {
	let activePersona: PersonaConfig | null = null;
	let activeCwd = "";
	let watcher: PersonaWatcher | null = null;
	// UI reference kept fresh by every event/command so the watcher callback
	// can fire notifications outside of handler context.
	let ui: MinimalUI | null = null;

	// Tool state: names registered by the active persona, and the active-tool
	// snapshot captured just before the persona was activated.
	let personaToolNames: string[] = [];
	let savedActiveTools: string[] | null = null;

	const CUSTOM_TYPE = "pi-persona-state";

	// ── UI status helper ───────────────────────────────────────────────────────

	function updateStatus(): void {
		ui?.setStatus(
			"pi-persona",
			activePersona ? `persona: ${activePersona.name}` : undefined,
		);
	}

	// ── Watcher lifecycle ─────────────────────────────────────────────────────

	async function activatePersonaTools(persona: PersonaConfig): Promise<void> {
		if (persona.toolFiles.length === 0) return;

		// Snapshot the current active tool set before adding persona tools
		savedActiveTools = pi.getActiveTools().map((t) => t.name);

		const newNames: string[] = [];
		for (const toolFile of persona.toolFiles) {
			try {
				// Dynamic import - jiti (the extension loader) handles .ts files.
				// Note: edits to existing tool files require /reload to pick up;
				// adding or removing files in tools/ works without /reload.
				const mod = await import(toolFile) as { default?: unknown };
				const toolDef = mod.default as ToolDefinition | undefined;
				if (
					toolDef &&
					typeof toolDef.name === "string" &&
					typeof toolDef.execute === "function"
				) {
					pi.registerTool(toolDef);
					newNames.push(toolDef.name);
				} else {
					ui?.notify(
						`Persona tool "${path.basename(toolFile)}": default export must be a tool definition with name + execute`,
						"warning",
					);
				}
			} catch (e) {
				ui?.notify(
					`Failed to load persona tool "${path.basename(toolFile)}": ${(e as Error).message}`,
					"error",
				);
			}
		}

		personaToolNames = newNames;
		if (newNames.length > 0) {
			pi.setActiveTools([...(savedActiveTools ?? []), ...newNames]);
		}
	}

	function deactivatePersonaTools(): void {
		if (personaToolNames.length === 0) return;
		if (savedActiveTools !== null) {
			pi.setActiveTools(savedActiveTools);
		}
		personaToolNames = [];
		savedActiveTools = null;
	}

	function startWatcher(persona: PersonaConfig): void {
		watcher?.stop();
		watcher = new PersonaWatcher(persona, async (next, changes, toolsChanged) => {
			activePersona = next;

			// Re-register tools if a .ts/.js file was modified, or files added/removed
			if (toolsChanged || changes.some((c) => c.includes("tools/"))) {
				// Rebase: remove old persona tools from baseline, then reload fresh
				const baseActive = pi
					.getActiveTools()
					.map((t) => t.name)
					.filter((n) => !personaToolNames.includes(n));
				savedActiveTools = baseActive;
				personaToolNames = [];
				await activatePersonaTools(next);
				if (toolsChanged && !changes.some((c) => c.includes("tools/"))) {
					changes.push("~ tools/* (use /reload for content edits)");
				}
			}

			if (changes.length === 0) return; // No meaningful diff
			const summary = changes.join(", ");
			ui?.notify(`Persona "${next.name}" auto-reloaded: ${summary}`, "info");
		});
	}

	function stopWatcher(): void {
		watcher?.stop();
		watcher = null;
	}

	// ── Session lifecycle ──────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		ui = ctx.ui;
		activeCwd = ctx.cwd;
		activePersona = null;
		stopWatcher();

		// Restore from the last persisted state entry
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (
				entry.type === "custom" &&
				(entry as { customType?: string }).customType === CUSTOM_TYPE
			) {
				const data = (entry as { data?: { name?: string | null } }).data;
				if (data?.name) {
					const personas = discoverPersonas(ctx.cwd);
					const basePath = personas.get(data.name);
					if (basePath) {
						activePersona = loadPersona(basePath, data.name);
						startWatcher(activePersona);
						await activatePersonaTools(activePersona);
						ctx.ui.notify(`Persona restored: "${data.name}"`, "info");
					}
				}
				break;
			}
		}

		updateStatus();
	});

	pi.on("session_shutdown", async () => {
		stopWatcher();
	});

	// ── /persona command ───────────────────────────────────────────────────────

	pi.registerCommand("persona", {
		description: "Manage personas. Usage: /persona [NAME | off | list]",

		getArgumentCompletions: (prefix: string) => {
			const personas = discoverPersonas(activeCwd);
			const items = [
				...[...personas.keys()].map((n) => ({ value: n, label: n })),
				{ value: "off", label: "off" },
				{ value: "list", label: "list" },
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},

		handler: async (args, ctx) => {
			ui = ctx.ui;
			activeCwd = ctx.cwd;
			const cmd = args?.trim() ?? "";

			// ── list (default) ──
			if (cmd === "" || cmd === "list") {
				const personas = discoverPersonas(ctx.cwd);
				if (personas.size === 0) {
					ctx.ui.notify(
						"No personas found. Create one in ~/.pi/persona/NAME/ or .pi/persona/NAME/",
						"info",
					);
					return;
				}
				const names = [...personas.keys()]
					.map((n) => (n === activePersona?.name ? `${n} ✓` : n))
					.join("  |  ");
				ctx.ui.notify(`Personas: ${names}`, "info");
				if (activePersona) {
					ctx.ui.notify(
						`Active: "${activePersona.name}" (${activePersona.basePath})`,
						"info",
					);
				}
				return;
			}

			// ── off ──
			if (cmd === "off" || cmd === "none") {
				stopWatcher();
				deactivatePersonaTools();
				activePersona = null;
				pi.appendEntry(CUSTOM_TYPE, { name: null });
				updateStatus();
				ctx.ui.notify("Persona deactivated.", "info");
				return;
			}

			// ── activate NAME ──
			const personas = discoverPersonas(ctx.cwd);
			const basePath = personas.get(cmd);
			if (!basePath) {
				const available = [...personas.keys()].join(", ") || "(none)";
				ctx.ui.notify(
					`Persona "${cmd}" not found. Available: ${available}`,
					"error",
				);
				return;
			}

			stopWatcher();
			deactivatePersonaTools();
			activePersona = loadPersona(basePath, cmd);
			startWatcher(activePersona);
			await activatePersonaTools(activePersona);
			pi.appendEntry(CUSTOM_TYPE, { name: cmd });
			updateStatus();

			// Summary of loaded files
			const parts: string[] = [];
			if (activePersona.preSystem) parts.push("pre/SYSTEM");
			if (activePersona.postSystem) parts.push("post/SYSTEM");
			if (activePersona.skills) parts.push("SKILLS");
			if (activePersona.preReinforce) parts.push("pre/REINFORCE");
			if (activePersona.postReinforce) parts.push("post/REINFORCE");
			for (const { n } of activePersona.preNReinforce)
				parts.push(`pre/${n}/REINFORCE`);
			for (const { n } of activePersona.postNReinforce)
				parts.push(`post/${n}/REINFORCE`);
			for (const n of personaToolNames)
				parts.push(`tools/${n}`);

			ctx.ui.notify(
				`Persona "${cmd}" activated.` +
				(parts.length ? ` Loaded: ${parts.join(", ")}.` : ""),
				"success",
			);
		},
	});

	// ── System prompt injection ────────────────────────────────────────────────

	pi.on("before_agent_start", async (event, ctx) => {
		ui = ctx.ui;
		if (!activePersona) return;

		let systemPrompt = event.systemPrompt;

		if (activePersona.preSystem) {
			systemPrompt = activePersona.preSystem + "\n\n" + systemPrompt;
		}
		if (activePersona.postSystem) {
			systemPrompt = systemPrompt + "\n\n" + activePersona.postSystem;
		}
		if (activePersona.skills) {
			systemPrompt = systemPrompt + "\n\n" + activePersona.skills;
		}

		return { systemPrompt };
	});

	// ── Reinforcement message injection ───────────────────────────────────────
	//
	// Injected into the ephemeral LLM context (deep copy only) – never stored
	// in session, invisible in the TUI.

	pi.on("context", async (event) => {
		if (!activePersona) return;

		const messages = event.messages as AnyMessage[];
		const idx = lastUserIndex(messages);
		if (idx === -1) return;

		// Turns completed so far = assistant messages already in context
		const turns = countTurns(messages);

		const toInjectPre: string[] = [];
		const toInjectPost: string[] = [];

		if (activePersona.preReinforce) toInjectPre.push(activePersona.preReinforce);
		if (activePersona.postReinforce) toInjectPost.push(activePersona.postReinforce);

		for (const { n, content } of activePersona.preNReinforce) {
			if (turns % n === 0) toInjectPre.push(content);
		}
		for (const { n, content } of activePersona.postNReinforce) {
			if (turns % n === 0) toInjectPost.push(content);
		}

		if (toInjectPre.length === 0 && toInjectPost.length === 0) return;

		const before = messages.slice(0, idx);
		const userMsg = messages[idx];
		const after = messages.slice(idx + 1);

		return {
			messages: [
				...before,
				...toInjectPre.map(makeUserMessage),
				userMsg,
				...toInjectPost.map(makeUserMessage),
				...after,
			],
		};
	});
}
