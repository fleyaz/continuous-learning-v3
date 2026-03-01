# Continuous Learning v2

Instinct-based learning system for Claude Code that observes sessions via hooks, creates atomic instincts with confidence scoring, and evolves them into skills/commands/agents.

## Features

- **Hooks-based Observation**: Captures all tool calls via PreToolUse/PostToolUse hooks (100% reliable)
- **Background Analysis**: Observer agent analyzes patterns in background
- **Instinct Creation**: Automatically creates instinct files based on repeated patterns
- **Confidence Scoring**: 0.3-0.9 weighted confidence for each instinct
- **Cross-platform**: Node.js scripts compatible with Windows, macOS, Linux

## Quick Start

### 1. Configure Hooks

Add to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node \"PATH_TO/hooks/observe.js\" pre"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node \"PATH_TO/hooks/observe.js\" post"
      }]
    }],
    "SessionStart": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node \"PATH_TO/agents/start-observer.js\" start"
      }]
    }]
  }
}
```

### 2. Initialize Directory

```bash
mkdir -p ~/.claude/homunculus/{instincts/{personal,inherited},evolved/{agents,skills,commands}}
touch ~/.claude/homunculus/observations.jsonl
```

### 3. Observer Commands

```bash
# Start observer (usually automatic via SessionStart hook)
node agents/start-observer.js start

# Check status
node agents/start-observer.js status

# Stop observer
node agents/start-observer.js stop
```

## File Structure

```
continuous-learning-v2/
├── SKILL.md                 # Skill definition
├── config.json              # Configuration
├── agents/
│   ├── observer.md         # Observer agent spec
│   └── start-observer.js   # Observer launcher
├── hooks/
│   └── observe.js          # Observation hook
└── scripts/
    ├── instinct-cli.py     # CLI tools
    └── test_parse_instinct.py
```

## Output

Instincts are created in `~/.claude/homunculus/instincts/personal/`:

```yaml
---
id: example-instinct
trigger: "when doing X"
confidence: 0.7
domain: "workflow"
source: "session-observation"
---

# Example Instinct

## Action
What to do when triggered

## Evidence
- Observed N times
```

## Version History

- v2.2.0: Observer writes files, limited analysis to 50 observations
- v2.1.0: Cross-platform Node.js, silent execution
- v2.0.0: Initial release
