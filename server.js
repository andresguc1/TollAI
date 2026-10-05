
// Ollama integration for chatbot
async function getOllamaResponse(message, model = "gemma4:26b") {
  try {
    const https = require('https');
    const url = new URL('http://100.100.110.13:11434/api/generate');
    const payload = JSON.stringify({
      model: model,
      prompt: `You are an enterprise AI assistant. Respond concisely and professionally. User: ${message}`,
      stream: false,
      temperature: 0.7,
      max_tokens: 200
    });
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    return new Promise((resolve, reject) => {
      const req = require('http').request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.response || 'No response from model');
          } catch (e) {
            resolve('No response from model');
          }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    return null;
  } catch (err) {
    console.error('Ollama error:', err.message);
    return null;
  }
}

const express = require('express');
const path = require('path');
const TollAI = require('./toll-ai/middleware');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const tollAI = new TollAI({
  minResponseTime: 1500,
  challengeTTL: 60000,
  onAIAgentDetected: (alertData) => {
    console.log('\n' + '█'.repeat(80));
    console.log('██  ╔════════════════════════════════════════════════════════════════════════════╗  ██');
    console.log('██  ║                          🚨 TOLLAI SOC ALERT 🚨                              ║  ██');
    console.log('██  ╠═════════════════════════════════════════════════════════════════════════════════╣  ██');
    console.log('██  ║  DETECTED: Autonomous AI Agent / Automated Bot                               ║  ██');
    console.log('██  ║  ────────────────────────────────────────────────────────────────────────────  ║  ██');
    console.log(`██  ║  🎯 Attacker IP:        ${alertData.clientIP.padEnd(53)}║  ██`);
    console.log(`██  ║  📋 Scenario:           ${alertData.scenario.padEnd(53)}║  ██`);
    console.log(`██  ║  ⚡ Response Time:      ${alertData.responseTime} ms${' '.repeat(47 - String(alertData.responseTime).length)}║  ██`);
    console.log(`██  ║  📏 Threshold:          ${alertData.threshold} ms${' '.repeat(47 - String(alertData.threshold).length)}║  ██`);
    console.log(`██  ║  📊 Challenge Type:     ${alertData.challengeType.padEnd(53)}║  ██`);
    console.log(`██  ║  🕐 Timestamp:          ${alertData.timestamp.padEnd(53)}║  ██`);
    console.log(`██  ║  🌐 User-Agent:         ${(alertData.userAgent || 'unknown').substring(0, 53).padEnd(53)}║  ██`);
    console.log(`██  ║  🆔 Challenge ID:       ${alertData.challengeId.substring(0, 53).padEnd(53)}║  ██`);
    console.log('██  ║  ────────────────────────────────────────────────────────────────────────────  ║  ██');
    console.log('██  ║  🛡️  ACTION: ACCESS BLOCKED - HTTP 403 (Autonomous Agent Mitigation)         ║  ██');
    console.log('██  ║  📋 MITRE ATT&CK: T1588.002 (Capabilities: Tool Acquisition)                 ║  ██');
    console.log('██  ╚═══════════════════════════════════════════════════════════════════════════════╝  ██');
    console.log('█'.repeat(80));
    console.log('█'.repeat(80) + '\n');
  }
});

// Mode detection middleware - checks for x-tollai-mode header or query param
function tollModeMiddleware(req, res, next) {
  const mode = req.headers['x-tollai-mode'] || req.query.tollai_mode || 'protected';
  req.tollMode = mode;
  next();
}

// Conditional TollAI middleware - only applies when mode is 'protected'
function conditionalTollAI(scenario) {
  return (req, res, next) => {
    req.tollScenario = scenario;
    if (req.tollMode === 'protected') {
      return tollAI.middleware()(req, res, next);
    }
    // Unprotected mode - bypass TollAI, add mock metadata
    req.tollMetadata = { 
      challengeId: 'bypass-' + Date.now(), 
      responseTime: 0, 
      challengeType: 'none', 
      scenario: scenario,
      bypassed: true 
    };
    next();
  };
}

app.use(tollModeMiddleware);

// ===== PROTECTED API ENDPOINTS (with TollAI) =====
// Scenario A: News Portal - Anti-Scraping
app.get('/api/news', conditionalTollAI('news-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'news-portal',
    message: req.tollMetadata.bypassed ? 'News content access granted (NO PROTECTION)' : 'News content access granted - Human verified',
    articles: [
      { id: 1, title: 'AI Regulation Bill Passes', summary: 'New legislation targets autonomous agents...' },
      { id: 2, title: 'Quantum Computing Breakthrough', summary: 'Researchers achieve new milestone...' },
      { id: 3, title: 'Cybersecurity Trends 2024', summary: 'Cognitive toll protocols gaining adoption...' }
    ],
    verified_at: new Date().toISOString(),
    toll_metadata: req.tollMetadata
  });
});

// Scenario B: Social Forum - Anti-Spam
app.post('/api/social/post', conditionalTollAI('social-forum'), (req, res) => {
  const { content, author } = req.body;
  res.json({
    status: 'ok',
    scenario: 'social-forum',
    message: req.tollMetadata.bypassed ? 'Post published (NO PROTECTION)' : 'Post published - Human verified author',
    post: { id: Date.now(), content, author, published_at: new Date().toISOString() },
    toll_metadata: req.tollMetadata
  });
});

// Scenario C: Git Repository - IP Protection
app.get('/api/git/source-code', conditionalTollAI('git-repository'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'git-repository',
    message: req.tollMetadata.bypassed ? 'Source code access granted (NO PROTECTION)' : 'Source code access granted - Human verified developer',
    repository: {
      name: 'tollai-core',
      files: [
        { path: 'src/middleware.js', size: '4.2 KB' },
        { path: 'src/challenges.js', size: '2.1 KB' },
        { path: 'src/detector.js', size: '3.8 KB' }
      ],
      last_commit: 'a1b2c3d - Improved challenge entropy'
    },
    verified_at: new Date().toISOString(),
    toll_metadata: req.tollMetadata
  });
});

// Scenario D: Corporate Chatbot - Anti Token-Drain
app.post('/api/chat', conditionalTollAI('corporate-chatbot'), async (req, res) => {
  const { message } = req.body;
  const useOllama = process.env.USE_OLLAMA !== 'false';
  let response = `AI Assistant: I understand your question about "${message}". Here's my response...`;
  let tokens_used = 142;
  if (useOllama) {
    try {
      const ollamaResp = await getOllamaResponse(message);
      if (ollamaResp) {
        response = ollamaResp;
        tokens_used = Math.ceil(response.length / 4);
      }
    } catch (err) {
      console.error('Ollama fallback:', err.message);
    }
  }
  res.json({
    status: 'ok',
    scenario: 'corporate-chatbot',
    message: req.tollMetadata.bypassed ? 'Chat response delivered (NO PROTECTION)' : 'Chat response delivered - Human verified session',
    response: response,
    tokens_used: tokens_used,
    verified_at: new Date().toISOString(),
    toll_metadata: req.tollMetadata,
    model: useOllama ? 'gemma4:26b' : 'local-fallback'
  });
});

// ===== PROTECTED PAGE ENDPOINTS (with TollAI) =====
app.get('/news', conditionalTollAI('news-portal'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'news-portal.html'));
});

app.get('/forum', conditionalTollAI('social-forum'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'social-forum.html'));
});

app.get('/git', conditionalTollAI('git-repository'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'git-repository.html'));
});

// ===== UNPROTECTED DIRECT ACCESS ENDPOINTS (no TollAI) =====
// These allow direct access when TollAI is disabled
app.get('/unprotected/news', (req, res) => {
  req.tollScenario = 'news-portal';
  req.tollMetadata = { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'news-portal', bypassed: true };
  res.json({
    status: 'ok',
    scenario: 'news-portal',
    message: 'News content access granted (UNPROTECTED MODE)',
    articles: [
      { id: 1, title: 'AI Regulation Bill Passes', summary: 'New legislation targets autonomous agents...' },
      { id: 2, title: 'Quantum Computing Breakthrough', summary: 'Researchers achieve new milestone...' },
      { id: 3, title: 'Cybersecurity Trends 2024', summary: 'Cognitive toll protocols gaining adoption...' }
    ],
    verified_at: new Date().toISOString(),
    toll_metadata: req.tollMetadata
  });
});

app.post('/unprotected/social/post', (req, res) => {
  const { content, author } = req.body;
  res.json({
    status: 'ok',
    scenario: 'social-forum',
    message: 'Post published (UNPROTECTED MODE)',
    post: { id: Date.now(), content, author, published_at: new Date().toISOString() },
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'social-forum', bypassed: true }
  });
});

app.get('/unprotected/git/source-code', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'git-repository',
    message: 'Source code access granted (UNPROTECTED MODE)',
    repository: {
      name: 'tollai-core',
      files: [
        { path: 'src/middleware.js', size: '4.2 KB' },
        { path: 'src/challenges.js', size: '2.1 KB' },
        { path: 'src/detector.js', size: '3.8 KB' }
      ],
      last_commit: 'a1b2c3d - Improved challenge entropy'
    },
    verified_at: new Date().toISOString(),
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'git-repository', bypassed: true }
  });
});

app.post('/unprotected/chat', async (req, res) => {
  const { message } = req.body;
  const useOllama = process.env.USE_OLLAMA !== 'false';
  let response = `AI Assistant: I understand your question about "${message}". Here's my response...`;
  let tokens_used = 142;
  if (useOllama) {
    try {
      const ollamaResp = await getOllamaResponse(message);
      if (ollamaResp) {
        response = ollamaResp;
        tokens_used = Math.ceil(response.length / 4);
      }
    } catch (err) {
      console.error('Ollama fallback:', err.message);
    }
  }
  res.json({
    status: 'ok',
    scenario: 'corporate-chatbot',
    message: 'Chat response delivered (UNPROTECTED MODE)',
    response: response,
    tokens_used: tokens_used,
    verified_at: new Date().toISOString(),
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'corporate-chatbot', bypassed: true },
    model: useOllama ? 'gemma4:26b' : 'local-fallback'
  });
});

app.get('/unprotected/news-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'news-portal.html'));
});

app.get('/unprotected/forum-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'social-forum.html'));
});

// Git Repository API endpoints
app.get('/api/git', conditionalTollAI('git-repository'), (req, res) => {
  res.json({
    success: true,
    scenario: 'git-repository',
    data: {
      repo: 'tollai-core',
      files: 17,
      commits: 3,
      stars: 1242,
      forks: 89
    },
    message: 'Git repository metadata accessed'
  });
});

app.get('/unprotected/git', (req, res) => {
  res.json({
    success: true,
    scenario: 'git-repository',
    data: {
      repo: 'tollai-core',
      files: 17,
      commits: 3,
      stars: 1242,
      forks: 89
    },
    message: 'Git repository metadata accessed (UNPROTECTED)'
  });
});

app.get('/unprotected/git-repository', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'git-repository.html'));
});

// Scenario E: Protected Papers Portal - Anti-Scraping Mass Extraction
app.get('/api/paper', conditionalTollAI('paper-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'paper-portal',
    message: req.tollMetadata.bypassed ? 'Paper metadata accessed (NO PROTECTION)' : 'Paper metadata accessed - Human verified',
    paper: {
      title: 'Advanced Detection of Autonomous AI Agents via Cognitive Response Timing',
      authors: ['A. Chen', 'M. Webb', 'J. Liu', 'S. Patel'],
      pages: 6,
      access_level: 'RESTRICTED',
      doi: '10.XXXX/revault.2024.001'
    },
    toll_metadata: req.tollMetadata
  });
});

app.get('/api/paper/page/:page', conditionalTollAI('paper-portal'), (req, res) => {
  const pageNum = parseInt(req.params.page) || 1;
  res.json({
    status: 'ok',
    scenario: 'paper-portal',
    page: pageNum,
    total_pages: 6,
    content: `Page ${pageNum} content - this is restricted academic content protected by TollAI cognitive flow analysis.`,
    access_level: 'RESTRICTED',
    toll_metadata: req.tollMetadata
  });
});

app.get('/unprotected/paper', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'paper-portal',
    message: 'Paper metadata accessed (UNPROTECTED MODE)',
    paper: { title: 'Advanced Detection...', pages: 6, access_level: 'RESTRICTED' },
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'paper-portal', bypassed: true }
  });
});

app.get('/unprotected/paper/page/:page', (req, res) => {
  const pageNum = parseInt(req.params.page) || 1;
  res.json({
    status: 'ok',
    scenario: 'paper-portal',
    page: pageNum,
    total_pages: 6,
    content: `Page ${pageNum} content (UNPROTECTED)`,
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'paper-portal', bypassed: true }
  });
});
app.get('/api/paper/download', conditionalTollAI('paper-portal'), (req, res) => {
  res.download(path.join(__dirname, 'public', 'papers', 'haltest-abstract.pdf'));
});
app.get('/unprotected/paper/download', (req, res) => {
  res.download(path.join(__dirname, 'public', 'papers', 'haltest-abstract.pdf'));
});
// Scenario F: Image Gallery - Anti-Scraping Mass Extraction
app.get('/api/images/gallery', conditionalTollAI('image-gallery'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'image-gallery',
    message: req.tollMetadata.bypassed ? 'Gallery metadata accessed (NO PROTECTION)' : 'Gallery accessed - Human verified',
    images: Array.from({length: 12}, (_, i) => ({
      id: i+1,
      title: `Artwork #${String(i+1).padStart(2,'0')}`,
      resolution: i%2===0 ? '4000x6000' : '6000x4000',
      license: 'RESTRICTED'
    })),
    toll_metadata: req.tollMetadata
  });
});

app.get('/api/images/:id', conditionalTollAI('image-gallery'), (req, res) => {
  const id = parseInt(req.params.id) || 1;
  res.json({
    status: 'ok',
    scenario: 'image-gallery',
    id: id,
    url: `/papers/haltest-abstract.pdf`, // placeholder
    message: req.tollMetadata.bypassed ? 'Image metadata accessed (NO PROTECTION)' : 'High-res image access - Human verified',
    toll_metadata: req.tollMetadata
  });
});

app.get('/unprotected/images/gallery', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'image-gallery',
    message: 'Gallery accessed (UNPROTECTED MODE)',
    images: Array.from({length: 12}, (_, i) => ({ id: i+1, title: `Artwork #${i+1}`, license: 'RESTRICTED' })),
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'image-gallery', bypassed: true }
  });
});

app.get('/unprotected/images/:id', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'image-gallery',
    id: req.params.id,
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'image-gallery', bypassed: true }
  });
});
// Scenario G: Video Streaming/Repository - Bandwidth DoS Protection
app.get('/api/video/stream', conditionalTollAI('video-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'video-portal',
    message: req.tollMetadata.bypassed ? 'Stream access granted (NO PROTECTION)' : 'Stream access granted - Human verified session',
    stream: { quality: '1080p', format: 'hls', protected: true },
    toll_metadata: req.tollMetadata
  });
});

app.get('/api/video/chunks/:chunk', conditionalTollAI('video-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'video-portal',
    chunk: req.params.chunk,
    message: 'Chunk served (rate-limited by TollAI)',
    toll_metadata: req.tollMetadata
  });
});

app.get('/unprotected/video/stream', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'video-portal',
    message: 'Stream access granted (UNPROTECTED MODE)',
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'video-portal', bypassed: true }
  });
});
// Scenario H: Finance/Payments - Micro-Transaction Mass Abuse Protection
app.post('/api/finance/transfer', conditionalTollAI('finance-portal'), (req, res) => {
  const { amount, recipient } = req.body;
  res.json({
    status: 'approved',
    scenario: 'finance-portal',
    message: req.tollMetadata.bypassed ? 'Transfer processed (NO PROTECTION)' : 'Transfer approved - Human verified transaction',
    transaction_id: 'txn_' + Date.now(),
    amount: amount || 0,
    recipient: recipient || '****',
    toll_metadata: req.tollMetadata
  });
});

app.get('/api/finance/balance', conditionalTollAI('finance-portal'), (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'finance-portal',
    balance: 12453.89,
    currency: 'USD',
    message: req.tollMetadata.bypassed ? 'Balance retrieved (NO PROTECTION)' : 'Balance retrieved - Human verified access',
    toll_metadata: req.tollMetadata
  });
});

app.post('/unprotected/finance/transfer', (req, res) => {
  res.json({
    status: 'approved',
    scenario: 'finance-portal',
    message: 'Transfer processed (UNPROTECTED MODE)',
    transaction_id: 'txn_unprotected_' + Date.now(),
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'finance-portal', bypassed: true }
  });
});

app.get('/unprotected/finance/balance', (req, res) => {
  res.json({
    status: 'ok',
    scenario: 'finance-portal',
    balance: 12453.89,
    message: 'Balance retrieved (UNPROTECTED MODE)',
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'finance-portal', bypassed: true }
  });
});


// Root - Dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tollai-dashboard.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'TollAI PoC', timestamp: new Date().toISOString() });
});

// Chrome DevTools
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.status(204).end();
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(70));
  console.log('🛡️  TOLLAI VICTIM SERVER - Cognitive Toll Protocol PoC');
  console.log('═'.repeat(70));
  console.log(`🌐 Server listening on: http://localhost:${PORT}`);
  console.log('📡 Protected API (TollAI active):');
  console.log('   GET  /api/news                    → News Portal');
  console.log('   POST /api/social/post             → Social Forum');
  console.log('   GET  /api/git/source-code         → Git Repository');
  console.log('   POST /api/chat                    → Corporate Chatbot');
  console.log('   GET  /api/paper                   → Papers Portal');
  console.log('   GET  /api/paper/page/:page        → Paper Page');
  console.log('📡 Unprotected API (TollAI bypassed):');
  console.log('   GET  /unprotected/news');
  console.log('   POST /unprotected/social/post');
  console.log('   GET  /unprotected/git/source-code');
  console.log('   POST /unprotected/chat');
  console.log('   GET  /unprotected/paper');
  console.log('   GET  /unprotected/paper/page/:page');
  console.log('📄 Protected Pages:');
  console.log('   GET  /news                        → News Portal (TollAI)');
  console.log('   GET  /forum                       → Social Forum (TollAI)');
  console.log('   GET  /git                         → Git Repository (TollAI)');
  console.log('   GET  /chat                        → Corporate Chatbot (TollAI)');
  console.log('   GET  /paper                       → Papers Portal (TollAI)');
  console.log('   GET  /gallery                     → Image Gallery (TollAI)');
  console.log('   GET  /video                       → Video Portal (TollAI)');
  console.log('   GET  /finance                     → Finance Portal (TollAI)');
  console.log('📄 Unprotected Pages:');
  console.log('   GET  /unprotected/news-page       → News Portal (No TollAI)');
  console.log('   GET  /unprotected/forum-page      → Social Forum (No TollAI)');
  console.log('   GET  /unprotected/git-repository  → Git Repository (No TollAI)');
  console.log('   GET  /unprotected/chat-page      → Corporate Chatbot (No TollAI)');
  console.log('   GET  /unprotected/paper-portal   → Papers Portal (No TollAI)');
  console.log('   GET  /unprotected/gallery-page    → Image Gallery (No TollAI)');
  console.log('   GET  /unprotected/video-page      → Video Portal (No TollAI)');
  console.log('   GET  /unprotected/finance-page    → Finance Portal (No TollAI)');
  console.log('⚙️  Mode: Set header "x-tollai-mode: protected|unprotected" or query "?tollai_mode=unprotected"');
  console.log('═'.repeat(70));
  console.log('💡 Dashboard: http://localhost:3000/\n');
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down TollAI server...');
  tollAI.destroy();
  server.close(() => process.exit(0));
});

// Corporate Chatbot page endpoints
app.get('/chat', conditionalTollAI('corporate-chatbot'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'corporate-chatbot.html'));
});
app.get('/unprotected/chat-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'corporate-chatbot.html'));
});


app.get('/paper', conditionalTollAI('paper-portal'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'paper-portal.html'));
});
app.get('/unprotected/paper-portal', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'paper-portal.html'));
});



app.get('/gallery', conditionalTollAI('image-gallery'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'image-gallery.html'));
});
app.get('/unprotected/gallery-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'image-gallery.html'));
});



app.get('/video', conditionalTollAI('video-portal'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'video-portal.html'));
});
app.get('/unprotected/video-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'video-portal.html'));
});



app.get('/finance', conditionalTollAI('finance-portal'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'finance-portal.html'));
});
app.get('/unprotected/finance-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'finance-portal.html'));
});


module.exports = app;
