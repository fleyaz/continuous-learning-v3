#!/usr/bin/env node
/**
 * Continuous Learning v2 - Observation Hook (Node.js version)
 * Cross-platform compatible: Windows, macOS, Linux
 */

const fs = require('fs');
const path = require('path');

// Get hook phase from CLI argument
const hookPhase = process.argv[2] || 'post';

// Paths
const configDir = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'homunculus');
const observationsFile = path.join(configDir, 'observations.jsonl');
const maxFileSizeMB = 10;
const pidFile = path.join(configDir, '.observer.pid');

// Signal observer process if running
function signalObserver() {
  if (!fs.existsSync(pidFile)) return;
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
    if (pid) {
      process.kill(pid, 'SIGUSR1');
    }
  } catch (e) {
    // Observer may not be running, ignore error
  }
}

// Ensure directory exists
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// Skip if disabled
if (fs.existsSync(path.join(configDir, 'disabled'))) {
  process.stdout.write(process.stdin.read());
  process.exit(0);
}

// Read JSON from stdin
let inputJson = '';
process.stdin.on('data', chunk => inputJson += chunk);
process.stdin.on('end', () => {
  try {
    if (!inputJson) {
      console.log(inputJson);
      return;
    }

    const data = JSON.parse(inputJson);
    const event = hookPhase === 'pre' ? 'tool_start' : 'tool_complete';

    // Extract fields
    const toolName = data.tool_name || data.tool || 'unknown';
    const toolInput = data.tool_input || data.input || {};
    const toolOutput = data.tool_output || data.output || {};
    const sessionId = data.session_id || 'unknown';

    // Truncate large inputs/outputs
    const truncate = (obj, maxLen = 5000) => {
      const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
      return str.slice(0, maxLen);
    };

    const observation = {
      timestamp: new Date().toISOString(),
      event,
      tool: toolName,
      session: sessionId,
      ...(event === 'tool_start' ? { input: truncate(toolInput) } : {}),
      ...(event === 'tool_complete' ? { output: truncate(toolOutput) } : {})
    };

    // Check file size and archive if needed
    if (fs.existsSync(observationsFile)) {
      const stats = fs.statSync(observationsFile);
      if (stats.size > maxFileSizeMB * 1024 * 1024) {
        const archiveDir = path.join(configDir, 'observations.archive');
        if (!fs.existsSync(archiveDir)) {
          fs.mkdirSync(archiveDir, { recursive: true });
        }
        const archiveFile = path.join(
          archiveDir,
          `observations-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
        );
        fs.renameSync(observationsFile, archiveFile);
      }
    }

    // Write observation
    fs.appendFileSync(observationsFile, JSON.stringify(observation) + '\n');

    // Signal observer to analyze
    signalObserver();

  } catch (e) {
    // On error, just pass through the original data
  }

  // Always output the original data to stdout
  console.log(inputJson);
});
