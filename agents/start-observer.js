#!/usr/bin/env node
/**
 * Continuous Learning v2 - Observer Agent Launcher (Node.js)
 *
 * Starts the background observer agent that analyzes observations
 * and creates instincts. Uses Claude Code default model.
 *
 * Usage:
 *   start-observer.js        # Start observer in background
 *   start-observer.js stop   # Stop running observer
 *   start-observer.js status # Check if observer is running
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.claude', 'homunculus');
const PID_FILE = path.join(CONFIG_DIR, '.observer.pid');
const LOG_FILE = path.join(CONFIG_DIR, 'observer.log');
const OBSERVATIONS_FILE = path.join(CONFIG_DIR, 'observations.jsonl');
const ARCHIVE_DIR = path.join(CONFIG_DIR, 'observations.archive');
const MIN_OBS_TO_ANALYZE = 10;  // 原 sh 默认是 10
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟

// Ensure config directory exists
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Write to log
function log(message) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

// Get PID from file
function getPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  try {
    return parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());
  } catch {
    return null;
  }
}

// Check if process is running
function isRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Count observations
function countObservations() {
  if (!fs.existsSync(OBSERVATIONS_FILE)) return 0;
  try {
    const content = fs.readFileSync(OBSERVATIONS_FILE, 'utf8');
    return content.split('\n').filter(line => line.trim()).length;
  } catch {
    return 0;
  }
}

// Get latest N observations for analysis
function getLatestObservations(maxLines = 50) {
  if (!fs.existsSync(OBSERVATIONS_FILE)) return '';
  try {
    const content = fs.readFileSync(OBSERVATIONS_FILE, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    const latest = lines.slice(-maxLines);
    return latest.join('\n');
  } catch {
    return '';
  }
}

// Analyze observations using Claude
function analyzeObservations() {
  const obsCount = countObservations();
  if (obsCount < MIN_OBS_TO_ANALYZE) {
    log(`Skipping analysis: only ${obsCount} observations (need ${MIN_OBS_TO_ANALYZE})`);
    return;
  }

  // Get latest 50 observations for analysis
  const latestObs = getLatestObservations(50);
  if (!latestObs) {
    log('No observations to analyze');
    return;
  }

  log(`Analyzing latest 50 of ${obsCount} observations...`);

  try {
    // Call Claude Code to analyze observations
    // Uses default model (no --model flag)
    const prompt = `Analyze these ${Math.min(obsCount, 50)} recent observations:

${latestObs}

IMPORTANT: Each instinct MUST be in a SEPARATE file. For EACH instinct found, output:

FILE: [unique-id].md
---
id: [unique-id]
trigger: "when [specific trigger]"
confidence: 0.5
domain: "workflow"
source: "session-observation"
---

# [Instinct Title]

## Action
[What to do]

## Evidence
- Observed [N] times in recent sessions

END

Output ONLY:
- If no pattern: "NO_PATTERNS"
- If patterns: Output the file content as shown above
Do NOT use Write tool, just output the content.`;

    // Clear CLAUDECODE env to avoid nested session error
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const claudeProcess = spawn('claude', ['--max-turns', '10', '--print', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env,
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    claudeProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    claudeProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    claudeProcess.on('close', (code) => {
      if (code === 0) {
        log('Claude analysis completed');

        // Parse output and create instinct files
        const lines = stdout.split('\n');
        let currentFile = null;
        let currentContent = [];

        for (const line of lines) {
          if (line.startsWith('FILE: ')) {
            // Save previous file
            if (currentFile && currentContent.length > 0) {
              try {
                const filePath = path.join(CONFIG_DIR, 'instincts', 'personal', currentFile);
                fs.writeFileSync(filePath, currentContent.join('\n'));
                log(`Created instinct: ${currentFile}`);
              } catch (e) {
                log(`Failed to write ${currentFile}: ${e.message}`);
              }
            }
            // Start new file
            currentFile = line.substring(6).trim();
            currentContent = [];
          } else if (currentFile) {
            currentContent.push(line);
          }
        }

        // Save last file
        if (currentFile && currentContent.length > 0) {
          try {
            const filePath = path.join(CONFIG_DIR, 'instincts', 'personal', currentFile);
            fs.writeFileSync(filePath, currentContent.join('\n'));
            log(`Created instinct: ${currentFile}`);
          } catch (e) {
            log(`Failed to write ${currentFile}: ${e.message}`);
          }
        }

        // Append analysis output to log
        if (stdout) {
          fs.appendFileSync(LOG_FILE, stdout + '\n');
        }
      } else {
        log(`Claude analysis failed (exit code: ${code})`);
        if (stderr) {
          fs.appendFileSync(LOG_FILE, `Error: ${stderr}\n`);
        }
      }

      // Archive processed observations
      archiveObservations();
    });

  } catch (e) {
    log(`Failed to run Claude: ${e.message}`);
    // Still archive even if Claude fails
    archiveObservations();
  }
}

// Archive observations file
function archiveObservations() {
  if (!fs.existsSync(OBSERVATIONS_FILE)) return;

  ensureDir(ARCHIVE_DIR);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveName = `processed-${timestamp}.jsonl`;
  const archivePath = path.join(ARCHIVE_DIR, archiveName);

  try {
    fs.renameSync(OBSERVATIONS_FILE, archivePath);
    // Create new empty observations file
    fs.writeFileSync(OBSERVATIONS_FILE, '');
    log(`Archived observations to ${archiveName}`);
  } catch (e) {
    log(`Failed to archive: ${e.message}`);
  }
}

// Start observer daemon
function start() {
  const existingPid = getPid();
  if (existingPid && isRunning(existingPid)) {
    console.log(`Observer already running (PID: ${existingPid})`);
    return;
  }

  ensureDir(CONFIG_DIR);
  ensureDir(path.join(CONFIG_DIR, 'instincts', 'personal'));

  log('Starting observer...');

  // Create daemon process
  const daemon = spawn(process.execPath, [__filename, '_daemon'], {
    detached: true,
    stdio: 'ignore'
  });

  daemon.unref();

  // Write PID
  fs.writeFileSync(PID_FILE, daemon.pid.toString());

  console.log(`Observer started (PID: ${daemon.pid})`);
  console.log(`Log: ${LOG_FILE}`);
}

// Daemon loop
function daemon() {
  const pid = process.pid;
  fs.writeFileSync(PID_FILE, pid.toString());
  log(`Observer started (PID: ${pid})`);

  // Handle signals
  process.on('SIGTERM', () => {
    log('Received SIGTERM, shutting down...');
    fs.unlinkSync(PID_FILE);
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('Received SIGINT, shutting down...');
    fs.unlinkSync(PID_FILE);
    process.exit(0);
  });

  // Handle SIGUSR1 for on-demand analysis
  process.on('SIGUSR1', () => {
    log('Received SIGUSR1, analyzing immediately...');
    analyzeObservations();
  });

  // Periodic check
  setInterval(() => {
    analyzeObservations();
  }, CHECK_INTERVAL_MS);
}

// Stop observer
function stop() {
  const pid = getPid();
  if (!pid) {
    console.log('Observer not running.');
    log('Stop requested - observer not running');
    return;
  }

  if (!isRunning(pid)) {
    console.log('Observer not running (stale PID file).');
    log('Stop requested - observer not running (stale PID file)');
    fs.unlinkSync(PID_FILE);
    return;
  }

  console.log(`Stopping observer (PID: ${pid})...`);
  log(`Stop requested for PID: ${pid}`);
  try {
    process.kill(pid, 'SIGTERM');
    // Wait a bit then cleanup
    setTimeout(() => {
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
      }
      console.log('Observer stopped.');
      log('Observer stopped');
    }, 1000);
  } catch (e) {
    console.log(`Failed to stop: ${e.message}`);
    log(`Failed to stop observer: ${e.message}`);
    fs.unlinkSync(PID_FILE);
  }
}

// Check status
function status() {
  const pid = getPid();
  if (!pid) {
    console.log('Observer not running');
    process.exit(1);
  }

  if (!isRunning(pid)) {
    console.log('Observer not running (stale PID file)');
    fs.unlinkSync(PID_FILE);
    process.exit(1);
  }

  const obsCount = countObservations();
  console.log(`Observer is running (PID: ${pid})`);
  console.log(`Log: ${LOG_FILE}`);
  console.log(`Observations: ${obsCount} lines`);
}

// Main
const command = process.argv[2] || 'start';

switch (command) {
  case 'start':
    start();
    break;
  case 'stop':
    stop();
    break;
  case 'status':
    status();
    break;
  case '_daemon':
    daemon();
    break;
  default:
    console.log(`Usage: ${process.argv[1]} {start|stop|status}`);
    process.exit(1);
}
