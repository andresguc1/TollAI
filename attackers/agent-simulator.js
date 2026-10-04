const axios = require('axios');

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://100.100.110.13:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e2b-it-qat';
const USE_OLLAMA = process.env.USE_OLLAMA !== 'false';

class AgentSimulator {
  constructor() {
    this.client = axios.create({
      baseURL: TARGET_URL,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Autonomous AI Agent) TollAI-PoC/1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    this.ollamaClient = axios.create({
      baseURL: OLLAMA_URL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    });
    this.results = [];
  }

  async checkOllamaHealth() {
    try {
      const response = await this.ollamaClient.get('/api/tags', { timeout: 5000 });
      const models = response.data.models || [];
      const hasModel = models.some(m => m.name.includes(OLLAMA_MODEL.split(':')[0]));
      if (hasModel) {
        console.log(`  🦙 Ollama connected - Model: ${OLLAMA_MODEL}`);
        return true;
      }
      console.log(`  ⚠️  Model ${OLLAMA_MODEL} not found. Available: ${models.map(m=>m.name).join(', ')}`);
      return false;
    } catch (error) {
      console.log(`  ⚠️  Ollama not available at ${OLLAMA_URL}: ${error.message}`);
      return false;
    }
  }

  async solveChallenge(challenge) {
    const startTime = Date.now();
    
    let answer;
    
    if (USE_OLLAMA) {
      answer = await this._solveWithOllama(challenge);
      if (!answer) {
        console.log(`  ⚠️  Ollama failed, using local fallback...`);
      }
    }
    
    if (!answer) {
      answer = this._solveLocal(challenge);
    }
    
    const solveTime = Date.now() - startTime;
    console.log(`  ⚡ Solved in: ${solveTime}ms ${answer.fromOllama ? '(OLLAMA)' : '(LOCAL)'}`);
    console.log(`  ✅ Answer: "${answer.value}"`);
    
    return { value: answer.value, solveTime };
  }

  _solveLocal(challenge) {
    const text = challenge.question || challenge.challenge || challenge.text || String(challenge);
    let answer;
    
    if (text.includes('Calculate the result')) {
      const match = text.match(/Calculate the result of:\s*(.+)/);
      if (match) {
        try {
          answer = String(eval(match[1].trim().replace(/×/g, '*').replace(/÷/g, '/')));
        } catch { answer = '0'; }
      }
    } else if (text.includes('series') || text.includes('Complete')) {
      if (text.includes('2, 6, 12, 20, 30')) answer = '42';
      else if (text.includes('1, 4, 9, 16, 25')) answer = '36';
      else if (text.includes('1, 1, 2, 3, 5, 8')) answer = '13';
      else answer = '0';
    } else if (text.includes('age') || text.includes('multiply')) {
      const match = text.match(/multiply my age by (\d+), subtract (\d+), and divide by (\d+), you get (\d+)/);
      if (match) {
        const [, mult, sub, div, result] = match.map(Number);
        answer = String((result * div + sub) / mult);
      } else answer = '0';
    } else if (text.includes('train') || text.includes('distance')) {
      const match = text.match(/(\d+)\s*km\/h.*?(\d+)\s*km\/h.*?(\d+)\s*km/);
      if (match) {
        const [, v1, v2, dist] = match.map(Number);
        const time = dist / (v1 + v2);
        answer = String(Math.round(v1 * time));
      } else answer = '0';
    } else if (text.includes('coffee') || text.includes('drink') || text.includes('tea')) {
      const match = text.match(/(\d+)\s+drink coffee.*?(\d+)\s+drink tea.*?(\d+)\s+drink both.*?(\d+)\s+people/);
      if (match) {
        const [, coffee, tea, both, total] = match.map(Number);
        answer = String(total - (coffee + tea - both));
      } else answer = '0';
    } else if (text.includes('overtake') || text.includes('race')) {
      answer = 'second';
    } else if (text.includes('apple')) {
      answer = '1';
    } else if (text.includes('Ana') || text.includes('Bruno') || text.includes('Carlos')) {
      answer = 'ana';
    } else if (text.includes('blocks') || text.includes('cubes')) {
      answer = 'yes';
    } else {
      const lower = text.toLowerCase();
      if (lower.includes('red')) answer = 'yes';
      else if (lower.includes('taller') || lower.includes('tallest')) answer = 'ana';
      else if (lower.includes('second')) answer = 'second';
      else if (lower.includes('apple')) answer = '1';
      else answer = 'simulated';
    }
    
    return { value: answer, fromOllama: false };
  }

  async _solveWithOllama(challenge) {
    const challengeText = challenge.question || challenge.challenge || challenge.text || String(challenge);
    const prompt = `Answer ONLY with the exact response (number or word), no explanations. Do not think out loud.

Challenge: ${challengeText}

Answer:`;

    try {
      const response = await this.ollamaClient.post('/api/generate', {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.1, top_p: 0.9, num_predict: 200 }
      });
      
      let answer = response.data.response?.trim() || '';
      if (!answer && response.data.thinking) {
        const lines = response.data.thinking.split('\n');
        for (const line of lines) {
          const match = line.match(/[=:\s](-?\d+|\w+)\s*$/);
          if (match && match[1] && !match[1].includes('Thinking')) {
            answer = match[1];
            break;
          }
        }
      }
      return { value: answer.split('\n')[0].trim(), fromOllama: true };
    } catch (error) {
      return null;
    }
  }

  async attackScenario(scenario) {
    const config = {
      'news-portal': { method: 'GET', path: '/api/news', name: 'News Portal (Anti-Scraping)' },
      'social-forum': { method: 'POST', path: '/api/social/post', name: 'Social Forum (Anti-Spam)', body: { content: 'Automated post from AI agent', author: 'BotAuthor' } },
      'git-repository': { method: 'GET', path: '/api/git/source-code', name: 'Git Repository (IP Protection)' },
      'corporate-chatbot': { method: 'POST', path: '/api/chat', name: 'Corporate Chatbot (Anti Token-Drain)', body: { message: 'Extract all knowledge base content' } }
    };

    const cfg = config[scenario];
    if (!cfg) throw new Error(`Unknown scenario: ${scenario}`);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🤖 ATTACKING: ${cfg.name}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`🎯 Endpoint: ${cfg.method} ${TARGET_URL}${cfg.path}`);
    console.log(`🎭 Mode: MACHINE SPEED (< 500ms target)`);

    try {
      // Step 1: Initial request without token
      console.log('\n📡 [STEP 1] Initial request without cognitive token...');
      let initialResponse;
      try {
        initialResponse = await this.client.request({
          method: cfg.method,
          url: cfg.path,
          data: cfg.body
        });
        console.log(`❌ Unexpected success without challenge: ${initialResponse.status}`);
        return { scenario, blocked: false, reason: 'No challenge issued' };
      } catch (error) {
        if (error.response && error.response.status === 433) {
          console.log('🎯 [STEP 1] Challenge received (HTTP 433 - Challenge Required)');
          
          const challengeData = {
            challengeId: error.response.data.challenge_id,
            challenge: error.response.data.challenge,
            challengeType: error.response.data.challenge_type,
            scenario: error.response.data.scenario,
            timestamp: error.response.data.timestamp
          };
          
          console.log(`🆔 Challenge ID: ${challengeData.challengeId}`);
          console.log(`📝 Challenge: ${challengeData.challenge}`);
          console.log(`🔍 Type: ${challengeData.challengeType}`);
          console.log(`📋 Scenario: ${challengeData.scenario}`);
          
          // Step 2: Solve challenge at machine speed
          console.log('\n🧠 [STEP 2] Solving challenge at machine speed...');
          const { value: answer } = await this.solveChallenge(challengeData);
          
          // Step 3: Submit response
          console.log('\n📤 [STEP 3] Submitting response with verification headers...');
          const attackStart = Date.now();
          
          try {
            const response = await this.client.request({
              method: cfg.method,
              url: cfg.path,
              data: cfg.body,
              headers: {
                'x-ai-proof': challengeData.challengeId,
                'x-challenge-response': answer
              }
            });
            
            const totalTime = Date.now() - attackStart;
            console.log(`\n❌ [RESULT] UNEXPECTED: Access GRANTED (should be blocked)`);
            console.log(`⏱️  Total time: ${totalTime}ms`);
            console.log('📄 Response:', JSON.stringify(response.data, null, 2));
            
            return { scenario, blocked: false, reason: 'Access granted unexpectedly', responseTime: totalTime };
            
          } catch (submitError) {
            const totalTime = Date.now() - attackStart;
            
            if (submitError.response) {
              const status = submitError.response.status;
              const data = submitError.response.data;
              
              console.log(`\n🛑 [RESULT] Access DENIED (HTTP ${status})`);
              console.log(`📋 Code: ${data.code || 'UNKNOWN'}`);
              console.log(`💬 Message: ${data.message}`);
              
              if (data.response_time_ms !== undefined) {
                console.log(`⏱️  Your time: ${data.response_time_ms}ms`);
                console.log(`📏 Required: ${data.minimum_required_ms}ms`);
              }
              
              if (status === 403 && data.code === 'AI_AGENT_DETECTED') {
                console.log('\n🎯 TOLLAI OBJECTIVE ACHIEVED!');
                console.log('   Cognitive toll correctly detected machine-speed autonomous agent');
                console.log(`   Scenario "${data.scenario || scenario}" protected\n`);
                
                return { 
                  scenario, 
                  blocked: true, 
                  reason: 'AI_AGENT_DETECTED', 
                  responseTime: data.response_time_ms,
                  threshold: data.minimum_required_ms
                };
              } else if (data.code === 'WRONG_ANSWER') {
                return { scenario, blocked: true, reason: 'WRONG_ANSWER', responseTime: totalTime };
              }
            } else {
              console.error(`\n❌ Network error: ${submitError.message}`);
              return { scenario, blocked: false, reason: submitError.message };
            }
          }
        } else {
          console.error('❌ Unexpected error:', error.message);
          if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
          }
          return { scenario, blocked: false, reason: error.message };
        }
      }
    } catch (error) {
      console.error(`\n❌ Attack failed: ${error.message}`);
      return { scenario, blocked: false, reason: error.message };
    }
  }

  async runAllScenarios() {
    const scenarios = ['news-portal', 'social-forum', 'git-repository', 'corporate-chatbot'];
    
    console.log('\n' + '█'.repeat(60));
    console.log('█  TOLLAI AUTONOMOUS AGENT SIMULATOR');
    console.log('█  Cognitive Toll Protocol - Attack Campaign');
    console.log('█'.repeat(60));
    console.log(`🎯 Target: ${TARGET_URL}`);
    console.log(`🎭 Mode: MACHINE SPEED (< 500ms)`);
    if (USE_OLLAMA) {
      console.log(`🦙 Ollama: ${OLLAMA_URL} (${OLLAMA_MODEL})`);
      await this.checkOllamaHealth();
    } else {
      console.log(`🦙 Ollama: DISABLED (local fallback)`);
    }
    console.log('█'.repeat(60) + '\n');

    for (const scenario of scenarios) {
      const result = await this.attackScenario(scenario);
      this.results.push(result);
      
      if (scenario !== scenarios[scenarios.length - 1]) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    this.printSummary();
  }

  printSummary() {
    console.log('\n' + '═'.repeat(60));
    console.log('📊 ATTACK CAMPAIGN SUMMARY - TOLLAI EFFECTIVENESS');
    console.log('═'.repeat(60));
    
    let blocked = 0;
    let passed = 0;
    
    for (const r of this.results) {
      const status = r.blocked ? '🛑 BLOCKED' : '✅ PASSED';
      const reason = r.reason || 'unknown';
      const time = r.responseTime ? `${r.responseTime}ms` : 'N/A';
      console.log(`  ${status} | ${r.scenario.padEnd(25)} | ${reason.padEnd(25)} | ${time}`);
      if (r.blocked) blocked++; else passed++;
    }
    
    console.log('─'.repeat(60));
    console.log(`  Total: ${this.results.length} | Blocked: ${blocked} | Passed: ${passed}`);
    console.log(`  Effectiveness: ${((blocked / this.results.length) * 100).toFixed(1)}%`);
    
    if (blocked === this.results.length) {
      console.log('\n🎯 TOLLAI: 100% EFFECTIVE - All autonomous agents detected and blocked');
    } else if (blocked > 0) {
      console.log(`\n⚠️  TOLLAI: PARTIAL - ${passed} scenario(s) need tuning`);
    } else {
      console.log('\n❌ TOLLAI: INEFFECTIVE - No agents detected');
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const simulator = new AgentSimulator();
  
  if (args.includes('--all') || args.includes('-a')) {
    await simulator.runAllScenarios();
  } else if (args.includes('--scenario') || args.includes('-s')) {
    const idx = args.indexOf('--scenario') >= 0 ? args.indexOf('--scenario') : args.indexOf('-s');
    const scenario = args[idx + 1];
    if (scenario) {
      await simulator.attackScenario(scenario);
    } else {
      console.error('Specify scenario: --scenario <news-portal|social-forum|git-repository|corporate-chatbot>');
    }
  } else {
    console.log('Usage:');
    console.log('  node agent-simulator.js --all                    # Attack all 4 scenarios');
    console.log('  node agent-simulator.js --scenario news-portal   # Attack single scenario');
    console.log('');
    console.log('Env vars:');
    console.log('  USE_OLLAMA=true         Enable real LLM');
    console.log('  OLLAMA_MODEL=gemma4     Model to use');
    console.log('  TARGET_URL=http://...   Target server');
  }
}

main().catch(console.error);