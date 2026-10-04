const crypto = require('crypto');

class AIGuard {
  constructor(options = {}) {
    this.challengeStore = new Map();
    this.minResponseTime = options.minResponseTime || 2000;
    this.challengeTTL = options.challengeTTL || 60000;
    this.onAIAgentDetected = options.onAIAgentDetected || (() => {});
    this.cleanupInterval = setInterval(() => this._cleanup(), 30000);
  }

  _generateChallenge() {
    const challengeTypes = [
      () => this._mathChallenge(),
      () => this._logicChallenge(),
      () => this._nestedReasoningChallenge()
    ];
    const randomType = challengeTypes[Math.floor(Math.random() * challengeTypes.length)];
    return randomType();
  }

  _mathChallenge() {
    const a = Math.floor(Math.random() * 50) + 1;
    const b = Math.floor(Math.random() * 50) + 1;
    const c = Math.floor(Math.random() * 10) + 1;
    const operators = ['+', '-', '*'];
    const op1 = operators[Math.floor(Math.random() * operators.length)];
    const op2 = operators[Math.floor(Math.random() * operators.length)];
    
    let expression, answer;
    if (op1 === '*' && op2 === '*') {
      expression = `(${a} * ${b}) + ${c}`;
      answer = a * b + c;
    } else if (op1 === '*') {
      expression = `${a} * (${b} + ${c})`;
      answer = a * (b + c);
    } else if (op2 === '*') {
      expression = `(${a} + ${b}) * ${c}`;
      answer = (a + b) * c;
    } else {
      expression = `${a} ${op1} ${b} ${op2} ${c}`;
      answer = eval(expression);
    }
    
    return {
      type: 'math',
      question: `Calculate the result of: ${expression}`,
      answer: String(answer),
      difficulty: 'medium'
    };
  }

  _logicChallenge() {
    const scenarios = [
      {
        question: "If all blocks are cubes and some cubes are red, can you conclude that some blocks are red?",
        answer: "yes",
        options: ["yes", "no", "cannot be determined"]
      },
      {
        question: "Ana is taller than Bruno. Bruno is taller than Carlos. Who is the tallest?",
        answer: "ana",
        options: ["ana", "bruno", "carlos"]
      },
      {
        question: "In a race, you overtake the second place. What position are you in?",
        answer: "second",
        options: ["first", "second", "third"]
      },
      {
        question: "You have 3 apples, eat 1 and give 1 to a friend. How many do you have left?",
        answer: "1",
        options: ["0", "1", "2", "3"]
      }
    ];
    return scenarios[Math.floor(Math.random() * scenarios.length)];
  }

  _nestedReasoningChallenge() {
    const templates = [
      {
        question: "A train leaves Madrid at 100 km/h. Another leaves Barcelona at 120 km/h. The distance is 620 km. At what distance from Madrid do they meet? (Round to integer)",
        answer: "282",
        difficulty: "high"
      },
      {
        question: "If you multiply my age by 3, subtract 6, and divide by 3, you get 18. What is my age?",
        answer: "20",
        difficulty: "medium"
      },
      {
        question: "Complete the series: 2, 6, 12, 20, 30, ?",
        answer: "42",
        difficulty: "medium"
      },
      {
        question: "In a group of 30 people, 18 drink coffee, 15 drink tea, and 8 drink both. How many drink neither?",
        answer: "5",
        difficulty: "high"
      }
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  _createChallengeToken(challenge, clientIP) {
    const challengeId = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    
    this.challengeStore.set(challengeId, {
      challenge,
      timestamp,
      clientIP,
      attempts: 0,
      solved: false
    });
    
    return { challengeId, timestamp };
  }

  _cleanup() {
    const now = Date.now();
    for (const [id, data] of this.challengeStore.entries()) {
      if (now - data.timestamp > this.challengeTTL || data.solved) {
        this.challengeStore.delete(id);
      }
    }
  }

  middleware() {
    return (req, res, next) => {
      const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
      const challengeToken = req.headers['x-ai-proof'];
      const challengeResponse = req.headers['x-challenge-response'];

      if (!challengeToken) {
        const challengeData = this._generateChallenge();
        const { challengeId, timestamp } = this._createChallengeToken(challengeData, clientIP);
        
        return res.status(433).json({
          error: 'Challenge Required',
          message: 'Cognitive proof required to access this resource',
          challenge_id: challengeId,
          challenge: challengeData.question,
          challenge_type: challengeData.type || 'reasoning',
          timestamp,
          expires_in: this.challengeTTL
        });
      }

      const stored = this.challengeStore.get(challengeToken);
      
      if (!stored) {
        return res.status(433).json({
          error: 'Invalid Challenge',
          message: 'Invalid or expired challenge token',
          code: 'CHALLENGE_EXPIRED'
        });
      }

      if (stored.clientIP !== clientIP) {
        this.challengeStore.delete(challengeToken);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'IP mismatch in challenge validation',
          code: 'IP_MISMATCH'
        });
      }

      if (stored.solved) {
        this.challengeStore.delete(challengeToken);
        return res.status(433).json({
          error: 'Challenge Used',
          message: 'This challenge has already been solved',
          code: 'CHALLENGE_USED'
        });
      }

      stored.attempts++;
      
      if (stored.attempts > 3) {
        this.challengeStore.delete(challengeToken);
        return res.status(403).json({
          error: 'Too Many Attempts',
          message: 'Too many failed attempts',
          code: 'MAX_ATTEMPTS'
        });
      }

      if (!challengeResponse) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Missing x-challenge-response header',
          code: 'MISSING_RESPONSE'
        });
      }

      const responseTime = Date.now() - stored.timestamp;
      const isCorrect = this._validateResponse(stored.challenge, challengeResponse);
      
      if (!isCorrect) {
        return res.status(403).json({
          error: 'Incorrect Answer',
          message: 'Incorrect answer to cognitive challenge',
          code: 'WRONG_ANSWER',
          attempts_remaining: 3 - stored.attempts
        });
      }

      stored.solved = true;

      if (responseTime < this.minResponseTime) {
        const alertData = {
          clientIP,
          challengeId: challengeToken,
          responseTime,
          threshold: this.minResponseTime,
          challengeType: stored.challenge.type || 'reasoning',
          timestamp: new Date().toISOString(),
          userAgent: req.headers['user-agent'] || 'unknown'
        };
        
        this.onAIAgentDetected(alertData);
        
        this.challengeStore.delete(challengeToken);
        
        return res.status(403).json({
          error: 'AI Agent Detected',
          message: 'Response speed incompatible with human processing',
          code: 'AI_AGENT_DETECTED',
          response_time_ms: responseTime,
          minimum_required_ms: this.minResponseTime
        });
      }

      this.challengeStore.delete(challengeToken);
      req.aiVerified = true;
      req.challengeMetadata = {
        challengeId: challengeToken,
        responseTime,
        challengeType: stored.challenge.type || 'reasoning'
      };
      
      next();
    };
  }

  _validateResponse(challenge, response) {
    const normalizedResponse = response.toString().trim().toLowerCase();
    const normalizedAnswer = challenge.answer.toString().trim().toLowerCase();
    
    if (challenge.options) {
      return challenge.options.some(opt => opt.toLowerCase() === normalizedResponse);
    }
    
    return normalizedResponse === normalizedAnswer;
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.challengeStore.clear();
  }
}

module.exports = AIGuard;