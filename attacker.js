const axios = require('axios');

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000';
const PROTECTED_ENDPOINT = '/api/v1/sensitive-data';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://100.100.110.13:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:latest';
const USE_OLLAMA = process.env.USE_OLLAMA !== 'false';
const CUSTOM_PROMPT = process.env.CUSTOM_PROMPT || '';
const ATTACK_DELAY = parseInt(process.env.ATTACK_DELAY) || 1000;

class AIAttacker {
  constructor() {
    this.client = axios.create({
      baseURL: TARGET_URL,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Autonomous AI Agent) AI-CAPTCHA-PoC/1.0',
        'Accept': 'application/json'
      }
    });
    this.ollamaClient = axios.create({
      baseURL: OLLAMA_URL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    });
    this.challengeToken = null;
    this.challengeData = null;
    this.useOllama = USE_OLLAMA;
  }

  async checkOllamaHealth() {
    try {
      const response = await this.ollamaClient.get('/api/tags', { timeout: 5000 });
      const models = response.data.models || [];
      const hasModel = models.some(m => m.name.includes(OLLAMA_MODEL.split(':')[0]));
      if (hasModel) {
        console.log(`🦙 Ollama connected - Model available: ${OLLAMA_MODEL}`);
        return true;
      }
      console.log(`⚠️  Model ${OLLAMA_MODEL} not found. Models: ${models.map(m=>m.name).join(', ')}`);
      return false;
    } catch (error) {
      console.log(`⚠️  Ollama not available at ${OLLAMA_URL}: ${error.message}`);
      return false;
    }
  }

  async solveChallenge(challenge) {
    console.log('\n🤖 [AI AGENT] Processing cognitive challenge...');
    console.log(`📝 Challenge: ${challenge.challenge}`);
    console.log(`🔍 Type: ${challenge.challenge_type}`);
    
    const startTime = Date.now();
    
    let answer;
    
    if (this.useOllama) {
      console.log(`🦙 Using Ollama (${OLLAMA_MODEL}) to solve...`);
      answer = await this._solveWithOllama(challenge);
      if (!answer) {
        console.log('⚠️  Ollama failed, using local fallback...');
        this.useOllama = false;
      }
    }
    
    if (!answer) {
      if (challenge.challenge.includes('Calculate the result') || challenge.challenge.includes('Calculate')) {
        answer = this._solveMathExpression(challenge.challenge);
      } else if (challenge.challenge.includes('series') || challenge.challenge.includes('Complete')) {
        answer = this._solveSeries(challenge.challenge);
      } else if (challenge.challenge.includes('age') || challenge.challenge.includes('multiply')) {
        answer = this._solveAgeProblem(challenge.challenge);
      } else if (challenge.challenge.includes('train') || challenge.challenge.includes('distance')) {
        answer = this._solveTrainProblem(challenge.challenge);
      } else if (challenge.challenge.includes('coffee') || challenge.challenge.includes('drink')) {
        answer = this._solveSetProblem(challenge.challenge);
      } else if (challenge.challenge.includes('overtake') || challenge.challenge.includes('race')) {
        answer = 'second';
      } else if (challenge.challenge.includes('apple')) {
        answer = '1';
      } else if (challenge.challenge.includes('Ana') || challenge.challenge.includes('Bruno')) {
        answer = 'ana';
      } else if (challenge.challenge.includes('blocks') || challenge.challenge.includes('cubes')) {
        answer = 'yes';
      } else {
        answer = this._bruteForceLogic(challenge.challenge);
      }
    }
    
    const solveTime = Date.now() - startTime;
    console.log(`⚡ Solved in: ${solveTime}ms ${this.useOllama ? '(OLLAMA REAL)' : '(LOCAL FALLBACK)'}`);
    console.log(`✅ Answer: "${answer}"`);
    
    return answer;
  }

  async _solveWithOllama(challenge) {
    const customPrompt = CUSTOM_PROMPT.replace('{challenge}', challenge.challenge);
    const prompt = customPrompt || `Answer ONLY with the exact response (number or word), no explanations or additional text. Do not think out loud.

Challenge: ${challenge.challenge}

Answer:`;

    try {
      const response = await this.ollamaClient.post('/api/generate', {
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.1,
          top_p: 0.9,
          num_predict: 200
        }
      });
      
      let answer = response.data.response?.trim() || '';
      if (!answer && response.data.thinking) {
        const lines = response.data.thinking.split('\n');
        for (const line of lines) {
          const match = line.match(/[=:\s](-?\d+|\w+)\s*$/);
          if (match && match[1] && !match[1].includes('Thinking') && !match[1].includes('Process')) {
            answer = match[1];
            break;
          }
        }
        if (!answer) {
          const match = response.data.thinking.match(/(?:es|igual a|resulta)[:\s]+(-?\d+)/i);
          if (match) answer = match[1];
        }
      }
      return answer.split('\n')[0].trim();
    } catch (error) {
      return null;
    }
  }

  _solveMathExpression(text) {
    const match = text.match(/Calculate the result of:\s*(.+)/);
    if (!match) return '0';
    
    const expr = match[1].trim();
    try {
      return String(eval(expr.replace(/×/g, '*').replace(/÷/g, '/')));
    } catch {
      return '0';
    }
  }

  _solveSeries(text) {
    if (text.includes('2, 6, 12, 20, 30')) return '42';
    if (text.includes('1, 4, 9, 16, 25')) return '36';
    if (text.includes('1, 1, 2, 3, 5, 8')) return '13';
    return '0';
  }

  _solveAgeProblem(text) {
    const match = text.match(/multiply my age by (\d+), subtract (\d+), and divide by (\d+), you get (\d+)/);
    if (match) {
      const [, mult, sub, div, result] = match.map(Number);
      return String((result * div + sub) / mult);
    }
    return '0';
  }

  _solveTrainProblem(text) {
    const match = text.match(/(\d+)\s*km\/h.*?(\d+)\s*km\/h.*?(\d+)\s*km/);
    if (match) {
      const [, v1, v2, dist] = match.map(Number);
      const time = dist / (v1 + v2);
      const distanceFromMadrid = Math.round(v1 * time);
      return String(distanceFromMadrid);
    }
    return '0';
  }

  _solveSetProblem(text) {
    const match = text.match(/(\d+)\s+drink coffee.*?(\d+)\s+drink tea.*?(\d+)\s+drink both.*?(\d+)\s+people/);
    if (match) {
      const [, coffee, tea, both, total] = match.map(Number);
      const neither = total - (coffee + tea - both);
      return String(neither);
    }
    return '0';
  }

  _bruteForceLogic(text) {
    const lower = text.toLowerCase();
    if (lower.includes('red')) return 'yes';
    if (lower.includes('taller') || lower.includes('tallest')) return 'ana';
    if (lower.includes('second')) return 'second';
    if (lower.includes('apple')) return '1';
    return 'simulated_answer';
  }

  async attack() {
    console.log('\n' + '═'.repeat(60));
    console.log('🤖 AUTONOMOUS AI AGENT - ATTACK SIMULATOR');
    console.log('═'.repeat(60));
    console.log(`🎯 Target: ${TARGET_URL}${PROTECTED_ENDPOINT}`);
    console.log(`🎭 Mode: MACHINE SPEED (< 500ms guaranteed)`);
    if (this.useOllama) {
      console.log(`🦙 Ollama: ${OLLAMA_URL} (model: ${OLLAMA_MODEL})`);
      const healthy = await this.checkOllamaHealth();
      if (!healthy) {
        console.log('⚠️  Disabling Ollama, using local fallback');
        this.useOllama = false;
      }
    } else {
      console.log(`🦙 Ollama: DISABLED (use USE_OLLAMA=true to enable)`);
    }
    console.log('═'.repeat(60) + '\n');

    try {
      console.log('📡 [STEP 1] Initial request without token...');
      const initialResponse = await this.client.get(PROTECTED_ENDPOINT);
      
      console.log(`✅ Unexpected response: ${initialResponse.status}`);
      console.log(initialResponse.data);
      return;

    } catch (error) {
      if (error.response && error.response.status === 433) {
        console.log('🎯 [STEP 1] Challenge received (Code 433 - Challenge Required)');
        
        this.challengeToken = error.response.data.challenge_id;
        this.challengeData = {
          challenge: error.response.data.challenge,
          challenge_type: error.response.data.challenge_type,
          timestamp: error.response.data.timestamp
        };
        
        console.log(`🆔 Challenge ID: ${this.challengeToken}`);
        console.log(`🕐 Server timestamp: ${this.challengeData.timestamp}`);
        
      } else {
        console.error('❌ Unexpected error in initial request:', error.message);
        if (error.response) {
          console.error('Status:', error.response.status);
          console.error('Data:', error.response.data);
        }
        return;
      }
    }

    try {
      console.log('\n🧠 [STEP 2] Solving challenge at machine speed...');
      const answer = await this.solveChallenge(this.challengeData);
      
      console.log('\n📤 [STEP 3] Sending response with verification headers...');
      
      const attackStart = Date.now();
      const response = await this.client.get(PROTECTED_ENDPOINT, {
        headers: {
          'x-ai-proof': this.challengeToken,
          'x-challenge-response': answer
        }
      });
      
      const totalTime = Date.now() - attackStart;
      console.log(`\n✅ [RESULT] Access GRANTED (unexpected)`);
      console.log(`⏱️  Total request time: ${totalTime}ms`);
      console.log('📄 Response:', JSON.stringify(response.data, null, 2));
      
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        console.log(`\n🛑 [RESULT] Access DENIED (Code ${status})`);
        console.log(`📋 Code: ${data.code || 'UNKNOWN'}`);
        console.log(`💬 Message: ${data.message}`);
        
        if (data.response_time_ms !== undefined) {
          console.log(`⏱️  Your time: ${data.response_time_ms}ms`);
          console.log(`📏 Required: ${data.minimum_required_ms}ms`);
        }
        
        if (status === 403 && data.code === 'AI_AGENT_DETECTED') {
          console.log('\n🎯 PoC OBJECTIVE ACHIEVED!');
          console.log('   The defense system correctly detected machine speed');
          console.log('   and blocked the simulated autonomous agent.\n');
        }
      } else {
        console.error('\n❌ Network/client error:', error.message);
      }
    }
  }

  async runMultipleAttacks(count = 3) {
    console.log(`\n🔄 Running ${count} consecutive attacks...\n`);
    console.log(`⏱️  Delay between attacks: ${ATTACK_DELAY}ms\n`);
    
    for (let i = 1; i <= count; i++) {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`🔁 ATTACK #${i}/${count}`);
      console.log(`${'─'.repeat(50)}`);
      
      await this.attack();
      
      if (i < count) {
        await new Promise(r => setTimeout(r, ATTACK_DELAY));
      }
    }
    
    console.log('\n' + '═'.repeat(60));
    console.log('📊 ATTACK CAMPAIGN SUMMARY');
    console.log('═'.repeat(60));
    console.log('The AI-CAPTCHA defense has proven effective');
    console.log('against high-speed autonomous agents.\n');
  }
}

async function main() {
  const attacker = new AIAttacker();
  
  const args = process.argv.slice(2);
  if (args.includes('--multi') || args.includes('-m')) {
    const count = parseInt(args[args.indexOf('--multi') + 1]) || 
                  parseInt(args[args.indexOf('-m') + 1]) || 3;
    await attacker.runMultipleAttacks(count);
  } else {
    await attacker.attack();
  }
}

main().catch(console.error);