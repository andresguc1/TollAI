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

app.use(express.static(path.join(__dirname, 'public')));

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://100.100.110.13:11434';

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
  addLog(`Starting attack with config: ${JSON.stringify(config)}`, 'info');

  const args = ['attacker.js'];
  
  if (config.useOllama) {
    process.env.USE_OLLAMA = 'true';
    process.env.OLLAMA_MODEL = config.ollamaModel || 'gemma4:e2b-it-qat';
    process.env.OLLAMA_URL = config.ollamaUrl || OLLAMA_URL;
  } else {
    process.env.USE_OLLAMA = 'false';
  }

  process.env.TARGET_URL = config.targetUrl || 'http://localhost:3000';

  if (config.multi > 1) {
    args.push('--multi', String(config.multi));
  }

  if (config.customPrompt) {
    process.env.CUSTOM_PROMPT = config.customPrompt;
  }

  if (config.delayBetween) {
    process.env.ATTACK_DELAY = String(config.delayBetween);
  }

  currentAttackProcess = spawn('node', args, {
    cwd: __dirname,
    env: { ...process.env }
  });

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
    addLog(`Attack finished with code: ${code}`, code === 0 ? 'success' : 'error');
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
    targetUrl: 'http://localhost:3000',
    useOllama: false,
    ollamaModel: 'gemma4:e2b-it-qat',
    ollamaUrl: OLLAMA_URL,
    multi: 1,
    delayBetween: 1000,
    customPrompt: ''
  });
});

app.listen(PORT, () => {
  console.log(`\n⚙️  ATTACK CONFIGURATOR - AI-CAPTCHA PoC`);
  console.log(`═══════════════════════════════════════════`);
  console.log(`🌐 Web UI: http://localhost:${PORT}`);
  console.log(`🔧 REST API: http://localhost:${PORT}/api/*`);
  console.log(`═══════════════════════════════════════════\n`);
});