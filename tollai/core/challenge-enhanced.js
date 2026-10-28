import { randomHex } from './crypto.js';
import { generateChallenge as generateBase, decodeChallenge, validateResponse, reverse, encodeB64, decodeB64, generateCipherMap, substitute } from './challenge.js';

const ENHANCED_TYPES = ['math', 'logic', 'reasoning'];

function addNoiseToMath() {
  const a = Math.floor(Math.random() * 200) + 10;
  const b = Math.floor(Math.random() * 50) + 5;
  const c = Math.floor(Math.random() * 30) + 3;
  const ops = ['+', '-', '*'];
  const op1 = ops[Math.floor(Math.random() * ops.length)];
  const op2 = ops[Math.floor(Math.random() * ops.length)];
  let expr, ans;
  if (op1 === '*' && op2 === '+') {
    expr = `${a} * ${b} + ${c}`;
    ans = a * b + c;
  } else if (op1 === '+' && op2 === '*') {
    expr = `(${a} + ${b}) * ${c}`;
    ans = (a + b) * c;
  } else if (op1 === '-' && op2 === '*') {
    expr = `${a} - ${b} * ${c}`;
    ans = a - b * c;
  } else {
    expr = `${a} ${op1} ${b} ${op2} ${c}`;
    const step = op1 === '+' ? a + b : op1 === '-' ? a - b : a * b;
    ans = op2 === '+' ? step + c : op2 === '-' ? step - c : step * c;
  }
  return { question: `Calculate the result of: ${expr}`, answer: String(ans) };
}

function generateWithEntropy(scenario = 'generic', riskScore = 0) {
  // Use enhanced generators for higher risk
  if (riskScore >= 40) {
    const base = addNoiseToMath();
    const { encodeMap, decodeMap } = generateCipherMap();
    const plaintext = base.question;
    const ciphertext = substitute(encodeB64(reverse(plaintext)), encodeMap);
    return {
      type: 'math',
      ciphertext,
      plaintext,
      meta: {
        pipeline: ['reverse', 'base64', 'substitution'],
        substitutionMap: decodeMap,
        version: 2,
        entropy: true
      },
      answer: base.answer,
      scenario,
      difficulty: riskScore >= 70 ? 'high' : 'medium'
    };
  }
  return generateBase(scenario);
}

export function generateChallenge(scenario = 'generic', options = {}) {
  const riskScore = options.riskScore || 0;
  if (options.enhanced !== false) {
    return generateWithEntropy(scenario, riskScore);
  }
  return generateBase(scenario);
}

export { decodeChallenge, validateResponse };
export default { generateChallenge, decodeChallenge, validateResponse };
