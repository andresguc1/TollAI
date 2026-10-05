/**
 * TollAI Challenge Pipeline — Modular Obfuscation Layers
 *
 * Pipeline: Base Question → Reverse → Base64 → Dynamic Substitution Cipher
 *
 * Feasibility Analysis:
 * - Layer 1 (Reverse): Trivial for LLMs, but breaks naive string matching / regex extraction
 * - Layer 2 (Base64): Standard encoding, LLMs decode natively, but adds token overhead (~33% size increase)
 * - Layer 3 (Dynamic Substitution): Highest friction — per-challenge cipher map forces LLM to
 *   "learn" a new alphabet per request. Cannot rely on training data patterns.
 *   Computational cost: O(n) per token for LLM to map cipher → plaintext.
 *   Token cost: Cipher text expands ~1.2-1.5x; reasoning steps increase 3-5x.
 *
 * Client Resolution (Browser/JS):
 *   1. fetch challenge payload { ciphertext, meta: { cipherMap, encoding: 'base64|reverse|substitution' } }
 *   2. Apply inverse pipeline: substitution.decode → atob → split('').reverse().join('')
 *   3. Parse plaintext question, compute answer, submit via x-challenge-response
 *
 * Server stores ONLY the plaintext answer in challengeStore (never the cipher).
 */

const crypto = require('crypto');

// ============================================
// Layer 1: Text Reversal
// ============================================
const reverse = (s) => s.split('').reverse().join('');

// ============================================
// Layer 2: Base64 Encoding
// ============================================
const encodeB64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const decodeB64 = (s) => Buffer.from(s, 'base64').toString('utf8');

// ============================================
// Layer 3: Dynamic Substitution Cipher
// ============================================
function generateCipherMap() {
  // Printable ASCII range 33-126 (94 chars) — safe for transport
  const chars = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i));
  const shuffled = [...chars].sort(() => Math.random() - 0.5);
  const encodeMap = Object.fromEntries(chars.map((c, i) => [c, shuffled[i]]));
  const decodeMap = Object.fromEntries(shuffled.map((c, i) => [c, chars[i]]));
  return { encodeMap, decodeMap };
}

function substitute(text, map) {
  // Single-pass character substitution to avoid replaceAll cascade bugs
  return text.split('').map(c => map[c] ?? c).join('');
}

// ============================================
// Pipeline Builder — Composable Transform Chain
// ============================================
class ChallengePipeline {
  constructor() {
    this.steps = [];
  }

  add(fn, label, meta = {}) {
    this.steps.push({ fn, label, ...meta });
    return this;
  }

  // Forward: plaintext → ciphertext
  encode(plaintext) {
    return this.steps.reduce((acc, { fn }) => fn(acc), plaintext);
  }

  // Reverse: ciphertext → plaintext (for client helper)
  decode(ciphertext) {
    return [...this.steps].reverse().reduce((acc, { fn }) => {
      return fn.inverse ? fn.inverse(acc) : acc;
    }, ciphertext);
  }

  // Metadata for client to reconstruct decode pipeline
  getMeta() {
    return this.steps.map(({ label }) => label);
  }
}

// Pre-defined pipeline: Reverse → Base64 → Substitution
function buildObfuscationPipeline() {
  const { encodeMap, decodeMap } = generateCipherMap();

  return new ChallengePipeline()
    .add(
      (s) => reverse(s),
      'reverse'
    )
    .add(
      (s) => encodeB64(s),
      'base64'
    )
    .add(
      (s) => substitute(s, encodeMap),
      'substitution',
      { decodeMap } // attach inverse data
    );
}

// Attach inverse functions to steps (monkey-patch for decode)
function withInverses(pipeline) {
  pipeline.steps.forEach((step, i) => {
    if (step.label === 'reverse') {
      step.fn.inverse = (s) => reverse(s);
    } else if (step.label === 'base64') {
      step.fn.inverse = (s) => decodeB64(s);
    } else if (step.label === 'substitution') {
      step.fn.inverse = (s) => substitute(s, step.decodeMap);
    }
  });
  return pipeline;
}

// ============================================
// Challenge Generators — Pure Functions, No Side Effects
// ============================================
const mathGenerators = [
  () => {
    const a = Math.floor(Math.random() * 50) + 1;
    const b = Math.floor(Math.random() * 50) + 1;
    const c = Math.floor(Math.random() * 10) + 1;
    const ops = ['+', '-', '*'];
    const op1 = ops[Math.floor(Math.random() * ops.length)];
    const op2 = ops[Math.floor(Math.random() * ops.length)];
    let expr, ans;
    if (op1 === '*' && op2 === '*') { expr = `(${a} * ${b}) + ${c}`; ans = a * b + c; }
    else if (op1 === '*') { expr = `${a} * (${b} + ${c})`; ans = a * (b + c); }
    else if (op2 === '*') { expr = `(${a} + ${b}) * ${c}`; ans = (a + b) * c; }
    else { expr = `${a} ${op1} ${b} ${op2} ${c}`; ans = eval(expr); }
    return { question: `Calculate the result of: ${expr}`, answer: String(ans) };
  },
  () => {
    const a = Math.floor(Math.random() * 100) + 1;
    const b = Math.floor(Math.random() * 100) + 1;
    const expr = `${a} + ${b}`;
    return { question: `Sum: ${expr}`, answer: String(a + b) };
  },
  () => {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const expr = `${a} * ${b}`;
    return { question: `Product: ${expr}`, answer: String(a * b) };
  }
];

const logicGenerators = [
  () => ({
    question: "If all blocks are cubes and some cubes are red, can you conclude that some blocks are red?",
    answer: "yes",
    options: ["yes", "no", "cannot be determined"]
  }),
  () => ({
    question: "Ana is taller than Bruno. Bruno is taller than Carlos. Who is the tallest?",
    answer: "ana",
    options: ["ana", "bruno", "carlos"]
  }),
  () => ({
    question: "In a race, you overtake the second place. What position are you in?",
    answer: "second",
    options: ["first", "second", "third"]
  }),
  () => ({
    question: "You have 3 apples, eat 1 and give 1 to a friend. How many do you have left?",
    answer: "1",
    options: ["0", "1", "2", "3"]
  }),
  () => ({
    question: "If it rains, the ground gets wet. The ground is wet. Did it rain?",
    answer: "cannot be determined",
    options: ["yes", "no", "cannot be determined"]
  }),
  () => ({
    question: "All roses are flowers. Some flowers fade quickly. Do all roses fade quickly?",
    answer: "no",
    options: ["yes", "no", "cannot be determined"]
  })
];

const reasoningGenerators = [
  () => ({
    question: "A train leaves Madrid at 100 km/h. Another leaves Barcelona at 120 km/h. The distance is 620 km. At what distance from Madrid do they meet? (Round to integer)",
    answer: "282"
  }),
  () => ({
    question: "If you multiply my age by 3, subtract 6, and divide by 3, you get 18. What is my age?",
    answer: "20"
  }),
  () => ({
    question: "Complete the series: 2, 6, 12, 20, 30, ?",
    answer: "42"
  }),
  () => ({
    question: "In a group of 30 people, 18 drink coffee, 15 drink tea, and 8 drink both. How many drink neither?",
    answer: "5"
  }),
  () => ({
    question: "A snail climbs 3 feet up a wall each day but slides down 2 feet each night. The wall is 10 feet high. How many days to reach the top?",
    answer: "8"
  }),
  () => ({
    question: "You have two ropes. Each burns for exactly 1 hour but at inconsistent rates. How do you measure 45 minutes?",
    answer: "Light both ends of rope 1 and one end of rope 2. When rope 1 finishes (30 min), light the other end of rope 2. It burns for 15 more min.",
    options: ["Light both ends of rope 1 and one end of rope 2...", "Light one rope...", "Cannot be done"]
  })
];

const ALL_GENERATORS = [
  ...mathGenerators.map(fn => ({ fn, type: 'math' })),
  ...logicGenerators.map(fn => ({ fn, type: 'logic' })),
  ...reasoningGenerators.map(fn => ({ fn, type: 'reasoning' }))
];

function pickRandomGenerator() {
  return ALL_GENERATORS[Math.floor(Math.random() * ALL_GENERATORS.length)];
}

// ============================================
// Main Export: generateChallenge(scenario)
// Returns { challengeId, ciphertext, meta, answer (plaintext for server storage) }
// ============================================
function generateChallenge(scenario) {
  const { fn, type } = pickRandomGenerator();
  const base = fn();

  // Build pipeline and encode
  const pipeline = withInverses(buildObfuscationPipeline());
  const plaintext = base.question;
  const ciphertext = pipeline.encode(plaintext);

  // Server stores ONLY the plaintext answer for validation
  // Client receives ciphertext + meta to decode
  return {
    type,
    ciphertext,
    plaintext, // include plaintext for backward compatibility
    meta: {
      pipeline: pipeline.getMeta(),
      // Provide decode map for client (substitution layer only needs this)
      substitutionMap: pipeline.steps.find(s => s.label === 'substitution')?.decodeMap || {}
    },
    answer: base.answer,
    options: base.options,
    scenario,
    difficulty: base.difficulty || (type === 'reasoning' ? 'high' : 'medium')
  };
}

function validateResponse(challenge, response) {
  const normalizedResponse = response.toString().trim().toLowerCase();
  const normalizedAnswer = challenge.answer.toString().trim().toLowerCase();

  if (challenge.options) {
    return challenge.options.some(opt => opt.toLowerCase() === normalizedResponse);
  }
  return normalizedResponse === normalizedAnswer;
}

module.exports = {
  generateChallenge,
  validateResponse,
  // Expose for testing / client SDK
  reverse,
  encodeB64,
  decodeB64,
  generateCipherMap,
  substitute,
  ChallengePipeline,
  buildObfuscationPipeline,
  withInverses
};