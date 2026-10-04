#!/usr/bin/env node

const { spawn } = require('child_process');
const http = require('http');
const { platform } = require('os');

const SERVERS = [
  {
    name: 'VICTIM SERVER',
    script: 'server.js',
    port: 3000,
    url: 'http://localhost:3000/health',
    color: '\x1b[36m', // cyan
    prefix: '[VICTIM]',
    openUrl: 'http://localhost:3000/'
  },
  {
    name: 'ATTACK CONFIGURATOR',
    script: 'attacker-config.js',
    port: 3001,
    url: 'http://localhost:3001/api/config/defaults',
    color: '\x1b[35m', // magenta
    prefix: '[CONFIG]',
    openUrl: 'http://localhost:3001'
  }
];

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';

let processes = [];
let serversReady = 0;

function openBrowser(url) {
  let command;
  let args = [];
  
  switch (platform()) {
    case 'darwin':
      command = 'open';
      args = [url];
      break;
    case 'win32':
      command = 'cmd';
      args = ['/c', 'start', '', url];
      break;
    default:
      command = 'xdg-open';
      args = [url];
  }
  
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch (e) {
    return false;
  }
}

function log(server, message, type = 'info') {
  const colors = {
    info: server.color,
    success: GREEN,
    warn: YELLOW,
    error: RED,
    debug: BLUE
  };
  const prefix = `${colors[type]}${server.prefix}${RESET}`;
  console.log(`${prefix} ${message}`);
}

function checkHealth(server) {
  return new Promise((resolve) => {
    const req = http.get(server.url, (res) => {
      if (res.statusCode === 200 || res.statusCode === 204) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(server, maxAttempts = 30) {
  log(server, `Waiting for ${server.name} on port ${server.port}...`, 'info');
  
  for (let i = 0; i < maxAttempts; i++) {
    const healthy = await checkHealth(server);
    if (healthy) {
      log(server, `${server.name} ready at http://localhost:${server.port}`, 'success');
      
      // Auto-open browser for this server
      if (server.openUrl) {
        log(server, `Opening browser: ${server.openUrl}`, 'info');
        openBrowser(server.openUrl);
      }
      
      return true;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  
  log(server, `${server.name} failed to start after ${maxAttempts}s`, 'error');
  return false;
}

function startServer(server) {
  return new Promise((resolve) => {
    const proc = spawn('node', [server.script], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => log(server, line, 'debug'));
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => log(server, line, 'error'));
    });

    proc.on('close', (code) => {
      log(server, `Process exited with code ${code}`, code === 0 ? 'success' : 'error');
    });

    proc.on('error', (err) => {
      log(server, `Failed to start: ${err.message}`, 'error');
    });

    processes.push({ server, proc });
    resolve(proc);
  });
}

function printBanner() {
  console.log(`
${BLUE}╔══════════════════════════════════════════════════════════════════════╗
║                    🛡️  AI-CAPTCHA PoC - FULL STACK                     ║
║         Cognitive Toll Protocol vs Autonomous AI Agents               ║
╚══════════════════════════════════════════════════════════════════════╝${RESET}
`);
}

function printAccessInfo() {
  console.log(`
${GREEN}═══════════════════════════════════════════════════════════════════════
  ALL SERVERS RUNNING - AI-CAPTCHA PoC READY
════════════════════════════════════════════════════════════════════════${RESET}

${BLUE}📡 VICTIM SERVER (AI-GUARD Protected)${RESET}
   • Root:           http://localhost:3000/
   • Health:         http://localhost:3000/health
   • Public API:     http://localhost:3000/api/v1/public
   • Protected:      http://localhost:3000/api/v1/sensitive-data
   • Admin Panel:    http://localhost:3000/api/v1/admin-panel

${BLUE}⚙️  ATTACK CONFIGURATOR (Web UI)${RESET}
   • Web Interface:  http://localhost:3001
   • API:            http://localhost:3001/api/*

${BLUE}🤖 ATTACKER (CLI)${RESET}
   • Single:         node attacker.js
   • Campaign:       node attacker.js --multi 3
   • With Ollama:    USE_OLLAMA=true OLLAMA_MODEL=gemma4:e2b-it-qat node attacker.js

${YELLOW}Press Ctrl+C to stop all servers${RESET}
`);
}

async function stopAll() {
  console.log(`\n${YELLOW}Shutting down all servers...${RESET}`);
  
  for (const { server, proc } of processes) {
    if (proc && !proc.killed) {
      log(server, 'Stopping...', 'warn');
      proc.kill('SIGTERM');
    }
  }
  
  await new Promise(r => setTimeout(r, 1000));
  
  for (const { server, proc } of processes) {
    if (proc && !proc.killed) {
      proc.kill('SIGKILL');
    }
  }
  
  console.log(`${GREEN}All servers stopped.${RESET}`);
  process.exit(0);
}

async function main() {
  printBanner();
  
  process.on('SIGINT', stopAll);
  process.on('SIGTERM', stopAll);
  
  // Start all servers
  console.log(`${BLUE}Starting servers...${RESET}\n`);
  
  for (const server of SERVERS) {
    await startServer(server);
  }
  
  // Wait for all to be healthy
  console.log(`\n${BLUE}Waiting for health checks...${RESET}\n`);
  
  const results = await Promise.all(
    SERVERS.map(server => waitForServer(server))
  );
  
  if (results.every(r => r)) {
    printAccessInfo();
  } else {
    console.log(`\n${RED}Some servers failed to start. Check logs above.${RESET}`);
    await stopAll();
  }
}

main().catch(err => {
  console.error(`${RED}Fatal error: ${err.message}${RESET}`);
  stopAll();
});