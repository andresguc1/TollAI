const express = require('express');
const path = require('path');
const TollAI = require('./toll-ai/middleware');

const app = express();
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
app.post('/api/chat', conditionalTollAI('corporate-chatbot'), (req, res) => {
  const { message } = req.body;
  res.json({
    status: 'ok',
    scenario: 'corporate-chatbot',
    message: req.tollMetadata.bypassed ? 'Chat response delivered (NO PROTECTION)' : 'Chat response delivered - Human verified session',
    response: `AI Assistant: I understand your question about "${message}". Here's my response...`,
    tokens_used: 142,
    verified_at: new Date().toISOString(),
    toll_metadata: req.tollMetadata
  });
});

// ===== PROTECTED PAGE ENDPOINTS (with TollAI) =====
app.get('/news', conditionalTollAI('news-portal'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'news-portal.html'));
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

app.post('/unprotected/chat', (req, res) => {
  const { message } = req.body;
  res.json({
    status: 'ok',
    scenario: 'corporate-chatbot',
    message: 'Chat response delivered (UNPROTECTED MODE)',
    response: `AI Assistant: I understand your question about "${message}". Here's my response...`,
    tokens_used: 142,
    verified_at: new Date().toISOString(),
    toll_metadata: { challengeId: 'unprotected', responseTime: 0, challengeType: 'none', scenario: 'corporate-chatbot', bypassed: true }
  });
});

app.get('/unprotected/news-page', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'news-portal.html'));
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
  console.log('📡 Unprotected API (TollAI bypassed):');
  console.log('   GET  /unprotected/news');
  console.log('   POST /unprotected/social/post');
  console.log('   GET  /unprotected/git/source-code');
  console.log('   POST /unprotected/chat');
  console.log('📄 Protected Pages:');
  console.log('   GET  /news                        → News Portal (TollAI)');
  console.log('📄 Unprotected Pages:');
  console.log('   GET  /unprotected/news-page       → News Portal (No TollAI)');
  console.log('⚙️  Mode: Set header "x-tollai-mode: protected|unprotected" or query "?tollai_mode=unprotected"');
  console.log('═'.repeat(70));
  console.log('💡 Dashboard: http://localhost:3000/\n');
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down TollAI server...');
  tollAI.destroy();
  server.close(() => process.exit(0));
});

module.exports = app;