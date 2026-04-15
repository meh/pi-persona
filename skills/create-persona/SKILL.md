---
name: create-persona
description: Create a new pi-persona persona directory with the right file structure. Use when the user wants to define a persona for pi, add personality or behavioral traits, set up reinforcement prompts, or configure skill guidance for the coding agent.
---

# Create Persona

## Overview

A **persona** is a named directory that customizes pi's behavior through system
prompt injections and reinforcement messages. Personas live in:

- `~/.pi/persona/NAME/` — global (available in all projects)
- `.pi/persona/NAME/` — project-local (takes priority over global)

Activate with `/persona NAME`, deactivate with `/persona off`.

---

## File Reference

```
persona-name/
├── SYSTEM.md              ← alias for post/SYSTEM.md (convenience)
├── REINFORCE.md           ← alias for post/REINFORCE.md (convenience)
├── SKILLS.md              ← skill guidance, always appended to system prompt
├── pre/
│   ├── SYSTEM.md          ← prepended to system prompt
│   ├── REINFORCE.md       ← injected as user message BEFORE each user message
│   ├── 5/
│   │   └── REINFORCE.md  ← same, but only every 5 turns
│   └── 10/
│       └── REINFORCE.md  ← same, but only every 10 turns
└── post/
    ├── SYSTEM.md          ← appended to system prompt (same as root SYSTEM.md)
    ├── REINFORCE.md       ← injected as user message AFTER each user message
    └── 3/
        └── REINFORCE.md  ← same, but only every 3 turns
```

All files are optional. Only files that exist are used.

### When each file fires

| File | Fires | Effect |
|------|-------|--------|
| `pre/SYSTEM.md` | Every turn | Prepended to system prompt |
| `post/SYSTEM.md` / `SYSTEM.md` | Every turn | Appended to system prompt |
| `SKILLS.md` | Every turn | Appended to system prompt |
| `pre/REINFORCE.md` | Every turn | Invisible user message before user's message |
| `post/REINFORCE.md` / `REINFORCE.md` | Every turn | Invisible user message after user's message |
| `pre/N/REINFORCE.md` | Every N completed turns | Same as pre/REINFORCE |
| `post/N/REINFORCE.md` | Every N completed turns | Same as post/REINFORCE |

**Reinforcement messages** are ephemeral — injected into the LLM context but
never stored in session or shown in the TUI.

**System prompt files** are applied to the system prompt before agent start.

The persona directory is **watched for changes** automatically. Edit, add, or
remove files and the persona reloads within ~300ms.

---

## Workflow

### Step 1: Clarify intent

Ask the user:
- What behavioral traits or personality should this persona have?
- Should it affect every message, or periodically?
- Should it prepend or append to the system prompt?
- Are there specific skills or workflows to guide the agent toward?
- Global persona (`~/.pi/persona/`) or project-local (`.pi/persona/`)?

### Step 2: Choose the right files

| Goal | File to create |
|------|---------------|
| Change how the agent presents itself overall | `post/SYSTEM.md` (or root `SYSTEM.md`) |
| Add constraints that must come before everything else | `pre/SYSTEM.md` |
| Remind the agent of something on every message | `post/REINFORCE.md` (or root `REINFORCE.md`) |
| Prime the agent with framing before the user speaks | `pre/REINFORCE.md` |
| Periodic nudges (e.g., "check your work every 5 turns") | `post/N/REINFORCE.md` |
| Document available skills the agent should reach for | `SKILLS.md` |

**Prefer `post/` over `pre/`** for most use cases. `pre/` is for constraints
that must override anything the user writes. REINFORCE is for things that
benefit from repetition; don't duplicate what's already in SYSTEM.

### Step 3: Write the content

**SYSTEM.md writing tips:**
- Write in second person ("You are…", "You always…")
- Be specific — vague instructions produce vague behavior
- Keep it focused; long system prompts dilute attention
- Don't repeat built-in pi instructions

**REINFORCE.md writing tips:**
- Use a clear header/label so the LLM recognizes the injection (e.g., `[PERSONA
  REMINDER]`)
- Keep it short — 2–5 lines maximum
- State one concrete behavioral instruction
- Reinforcement fires every turn, so it accumulates in context; less is more

**SKILLS.md writing tips:**
- Describe skills in terms of *when* to reach for them, not just *what* they
  are
- Reference skill names the LLM can invoke with `/skill:name`
- Can include condensed skill content for skills that should always be in
  context

### Step 4: Create the files

Use the `bash` tool to create the directory and files. Example:

```bash
mkdir -p ~/.pi/persona/NAME/post
cat > ~/.pi/persona/NAME/post/SYSTEM.md << 'EOF'
<content>
EOF
```

Or for project-local:

```bash
mkdir -p .pi/persona/NAME/post
```

### Step 5: Activate and verify

```
/persona NAME
```

Then send a test message and confirm the persona is shaping behavior as
expected.

---

## Examples

### Minimal: personality tweak

```
~/.pi/persona/concise/
└── SYSTEM.md
```

```markdown
You value brevity. Respond in as few words as possible while remaining complete
and accurate. Never pad responses with summaries, affirmations, or filler
phrases like "Great question!" or "Sure, I can help with that."
```

---

### System prompt + periodic reminder

```
~/.pi/persona/careful/
├── post/
│   └── SYSTEM.md
└── post/
    └── 5/
        └── REINFORCE.md
```

**`post/SYSTEM.md`:**
```markdown
You are a careful, methodical engineer. Before implementing anything:
1. Restate your understanding of the requirement
2. List any ambiguities or edge cases you see
3. Propose the approach and wait for confirmation before writing code
```

**`post/5/REINFORCE.md`:**
```markdown
[PERIODIC CHECK] Have you verified your last change against the original
requirements? If not, pause and confirm before continuing.
```

---

### Pre-system constraint (hard override)

```
~/.pi/persona/readonly/
└── pre/
    └── SYSTEM.md
```

```markdown
IMPORTANT: You are in READ-ONLY mode. You must NEVER use the write, edit, or
bash tools to modify any file. Analysis and explanation only. If the user asks
you to make changes, explain that you are in read-only mode and describe what
you would do instead.
```

---

### Skills guidance

```
~/.pi/persona/architect/
├── SYSTEM.md
└── SKILLS.md
```

**`SYSTEM.md`:**
```markdown
You think architecturally. When approaching problems, consider system design,
data flow, and long-term maintainability before implementation details.
```

**`SKILLS.md`:**
```markdown
## Skills to reach for

- **develop-adr**: When making significant technical decisions, structure your
  recommendation as an Architecture Decision Record using `/skill:develop-adr`.
- **deliver-prd**: When scoping features, use `/skill:deliver-prd` to create a
  proper specification before starting implementation.
- **define-opportunity-tree**: When exploring product direction, use
  `/skill:define-opportunity-tree` to map outcomes to solutions.
```

---

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Putting everything in REINFORCE | Reserve REINFORCE for things that genuinely need repetition; prefer SYSTEM for stable traits |
| Very long REINFORCE content | Keep under 5 lines; the LLM sees it every turn so context cost adds up fast |
| Vague SYSTEM instructions ("be helpful") | Be specific ("When asked to review code, always check for error handling first") |
| Using `pre/SYSTEM.md` for personality | Use `post/SYSTEM.md` — `pre/` is for hard constraints that must survive user overrides |
| Creating a persona for every project | Prefer project-local `.pi/persona/` over polluting global `~/.pi/persona/` |
