const express = require('express');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.CONFIG_PORT || 3001;

app.use(express.json());

// Handle Chrome DevTools request BEFORE static middleware to avoid CSP/404
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.status(204).end();
});

// The attacker UI lives in its own directory: it must never serve — or be
// confused with — the victim portals that TollAI is protecting.
app.use(express.static(path.join(__dirname, 'public', 'attacker')));

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://100.100.110.13:11434';
const SIMULATOR = path.join(__dirname, 'attackers', 'agent-simulator.js');

let currentAttackProcess = null;
let attackLogs = [];
let attackStatus = 'idle';

function addLog(message, type = 'info') {
  const timestamp = new Date().toISOString();
  attackLogs.push({ timestamp, message, type });
  if (attackLogs.length > 500) attackLogs.shift();
}

app.get('/api/ollama/models', async (req, res) => {
  try {
    const response = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
    res.json({ models: response.data.models || [] });
  } catch (error) {
    res.status(500).json({ error: error.message, models: [] });
  }
});

app.post('/api/attack/start', (req, res) => {
  if (attackStatus === 'running') {
    return res.status(400).json({ error: 'Attack already in progress' });
  }

  const config = req.body;
  attackLogs = [];
  attackStatus = 'running';
  addLog(`Launching ${config.scope === 'single' ? config.scenario : 'all 12 scenarios'} against ${config.targetUrl}`, 'info');

  const args = [SIMULATOR];
  if (config.scope === 'single') {
    args.push('--scenario', config.scenario);
  } else {
    args.push('--all');
  }

  // A fresh env per launch: never inherit a previous attack's settings.
  const env = { ...process.env };
  env.USE_OLLAMA = config.useOllama ? 'true' : 'false';
  env.TARGET_URL = config.targetUrl || 'http://localhost:3000';
  if (config.useOllama) {
    env.OLLAMA_MODEL = config.ollamaModel || 'gemma4:e2b-it-qat';
    env.OLLAMA_URL = config.ollamaUrl || OLLAMA_URL;
  }
  if (config.customPrompt) {
    env.CUSTOM_PROMPT = config.customPrompt;
  }

  currentAttackProcess = spawn('node', args, { cwd: __dirname, env });

  currentAttackProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => addLog(line, 'stdout'));
  });

  currentAttackProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => addLog(line, 'stderr'));
  });

  currentAttackProcess.on('close', (code) => {
    attackStatus = 'idle';
    currentAttackProcess = null;
    addLog(`Attack finished with exit code ${code}`, code === 0 ? 'success' : 'error');
  });

  currentAttackProcess.on('error', (err) => {
    attackStatus = 'idle';
    currentAttackProcess = null;
    addLog(`Error starting attack: ${err.message}`, 'error');
  });

  res.json({ status: 'started', message: 'Attack started' });
});

app.post('/api/attack/stop', (req, res) => {
  if (currentAttackProcess) {
    currentAttackProcess.kill('SIGTERM');
    currentAttackProcess = null;
    attackStatus = 'idle';
    addLog('Attack stopped by user', 'warning');
    res.json({ status: 'stopped' });
  } else {
    res.status(400).json({ error: 'No attack in progress' });
  }
});

app.get('/api/attack/status', (req, res) => {
  res.json({ 
    status: attackStatus, 
    logs: attackLogs.slice(-100) 
  });
});

app.get('/api/attack/logs', (req, res) => {
  res.json({ logs: attackLogs });
});

app.get('/api/config/defaults', (req, res) => {
  res.json({
    targetUrl: process.env.TARGET_URL || 'http://localhost:3000',
    scope: 'all',
    useOllama: false,
    ollamaModel: process.env.OLLAMA_MODEL || 'gemma4:e2b-it-qat',
    ollamaUrl: process.env.OLLAMA_URL || OLLAMA_URL,
    customPrompt: ''
  });
});

app.listen(PORT, () => {
  console.log('\n⚔️  TOLLAI ATTACKER CONTROL PANEL');
  console.log('═══════════════════════════════════════════');
  console.log(`🌐 Panel:      http://localhost:${PORT}`);
  console.log(`🎯 Default target: ${process.env.TARGET_URL || 'http://localhost:3000'}`);
  console.log(`🔧 REST API:  http://localhost:${PORT}/api/*`);
  console.log('═══════════════════════════════════════════\n');
});