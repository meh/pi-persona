# pi-persona

A [pi](https://github.com/badlogic/pi-mono) extension for defining and
switching between named **personas** — rich behavioral profiles that modify the
system prompt, inject reinforcement messages, and load skills automatically.

## Installation

Copy or symlink this directory into an auto-discovered extension location:

```bash
# Global (all projects)
ln -s /path/to/pi-persona ~/.pi/agent/extensions/pi-persona

# Project-local
ln -s /path/to/pi-persona .pi/extensions/pi-persona
```

Or reference it in `settings.json`:

```json
{
  "extensions": ["/path/to/pi-persona"]
}
```

## Defining Personas

Personas live in named directories under `~/.pi/persona/NAME/` (global) or
`.pi/persona/NAME/` (project-local). Project-local personas take priority over
globals when names collide.

### Directory Structure

```
~/.pi/persona/my-persona/
├── SYSTEM.md          ← alias for post/SYSTEM.md
├── REINFORCE.md       ← alias for post/REINFORCE.md
├── SKILLS.md          ← skill descriptions appended to system prompt
├── pre/
│   ├── SYSTEM.md      ← prepended to system prompt
│   ├── REINFORCE.md   ← injected before every user message
│   ├── 5/
│   │   └── REINFORCE.md  ← injected before user message every 5 turns
│   └── 10/
│       └── REINFORCE.md  ← injected before user message every 10 turns
└── post/
    ├── SYSTEM.md      ← appended to system prompt
    ├── REINFORCE.md   ← injected after every user message
    └── 3/
        └── REINFORCE.md  ← injected after user message every 3 turns
```

All files are optional. Only existing files are loaded.

### File Semantics

| File | When | Effect |
|------|------|--------|
| `pre/SYSTEM.md` | Every turn | Prepended to system prompt |
| `post/SYSTEM.md` / `SYSTEM.md` | Every turn | Appended to system prompt |
| `SKILLS.md` | Every turn | Appended to system prompt (skill guidance) |
| `pre/REINFORCE.md` | Every turn | Injected as user message **before** the user's message |
| `post/REINFORCE.md` / `REINFORCE.md` | Every turn | Injected as user message **after** the user's message |
| `pre/N/REINFORCE.md` | Every N turns | Like `pre/REINFORCE.md` but only every N completed turns |
| `post/N/REINFORCE.md` | Every N turns | Like `post/REINFORCE.md` but only every N completed turns |


**Reinforcement messages** are injected into the LLM context ephemerally — they
are never stored in the session and are invisible in the TUI. The LLM sees them
but the user does not.

**System prompt files** are applied to the system prompt before agent start.

## Commands

| Command | Description |
|---------|-------------|
| `/persona` | Show active persona and available personas |
| `/persona NAME` | Activate a persona by name |
| `/persona list` | List all available personas |
| `/persona off` | Deactivate the current persona |

Tab completion is available for persona names.

## Persona Persistence

The active persona is saved to the session and automatically restored when
resuming that session.

## Live Reload

The active persona directory is **watched for file system changes**. Any `.md`
file you add, edit, or delete is picked up automatically within ~1s. A
notification lists what changed (e.g. `+ pre/REINFORCE, ~ post/SYSTEM`). No
need to deactivate and reactivate.

## Example Persona: `senior-engineer`

```
~/.pi/persona/senior-engineer/
├── post/
│   └── SYSTEM.md
└── SKILLS.md
```

**`post/SYSTEM.md`:**
```markdown
You are a senior software engineer with 15+ years of experience. You:
- Prefer simple, readable solutions over clever ones
- Always consider edge cases and error handling
- Suggest tests for non-trivial logic
- Ask clarifying questions before diving into large changes
```

**`SKILLS.md`:**
```markdown
## Available Skills

When the user asks about architecture or design decisions, apply the
`develop-adr` skill to structure your response as an Architecture Decision
Record.

When asked to break down work, use the `deliver-user-stories` skill format.
```

## Skills

The `create-persona` skill is bundled with this package and teaches the agent
how to scaffold a new persona — file structure, content guidelines, and common
patterns. Invoke it with:

```
/skill:create-persona
```

Or just describe what you want and the agent will use it automatically.

---

## Example Persona: `rubber-duck`

```
~/.pi/persona/rubber-duck/
└── pre/
    └── REINFORCE.md
```

**`pre/REINFORCE.md`:**
```markdown
[RUBBER DUCK MODE]
Before answering, ask the user one clarifying question to help them think through their problem themselves. Only after they respond should you offer your actual analysis.
```

## N-Turn Reinforcement Example

To inject a reminder every 5 turns:

```
~/.pi/persona/focused/
└── post/
    └── 5/
        └── REINFORCE.md
```

**`post/5/REINFORCE.md`:**
```markdown
[PERIODIC REMINDER]
Stay focused on the current task. If you haven't made progress in the last few
responses, summarize what's blocking you and ask for guidance.
```
