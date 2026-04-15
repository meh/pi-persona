// @ts-ignore - resolved from pi's node_modules at runtime
import { Type } from "@sinclair/typebox";
// @ts-ignore - resolved from pi's node_modules at runtime
import { Text } from "@mariozechner/pi-tui";

/**
 * Renders a greentext story — each line prefixed with > and displayed in green.
 * The LLM passes plain lines; the tool formats them for display.
 */
export default {
	name: "greentext",
	label: "Greentext",
	description:
		"Format and display a greentext story. Pass an array of plain lines (no leading >). " +
		"Use this to express irony, tell a story, or react with greentext energy. " +
		"Example: lines=[\"be me\", \"try kubernetes for a todo app\", \"wonder why deploy takes 45 minutes\", \"mfw\"]",
	parameters: Type.Object({
		lines: Type.Array(
			Type.String({ description: "One line of the story, without the leading >" }),
			{ description: "Lines of the greentext story, in order" },
		),
	}),

	async execute(_id: string, params: { lines: string[] }) {
		const story = params.lines.map((l) => `>${l}`).join("\n");
		return {
			content: [{ type: "text", text: story }],
			details: { lines: params.lines },
		};
	},

	renderResult(
		result: { details?: { lines?: string[] } },
		_options: unknown,
		theme: { fg: (color: string, text: string) => string },
	) {
		const lines: string[] = result.details?.lines ?? [];
		const rendered = lines
			.map((l) => theme.fg("success", ">") + theme.fg("text", l))
			.join("\n");
		return new Text(rendered || theme.fg("muted", "(empty greentext)"), 0, 0);
	},
};
