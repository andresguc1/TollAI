/**
 * TollAI Challenge Pipeline — Modular Obfuscation Layers
 *
 * Pipeline: Plaintext → Reverse → Base64 → Dynamic Substitution Cipher
 *
 * Feasibility Analysis:
 * - Layer 1 (Reverse): Trivial for LLMs, but breaks naive string matching / regex extraction
 * - Layer 2 (Base64): Standard encoding, LLMs decode natively, but adds token overhead (~33% size increase)
 * - Layer 3 (Dynamic Substitution): Highest friction — per-challenge cipher map forces an
 *   LLM to "learn" a new alphabet per request. Cannot rely on training data patterns.
 *
 * Client Resolution (Browser/JS):
 *   1. fetch challenge payload { ciphertext, meta: { pipeline, substitutionMap } }
 *   2. Apply the inverse pipeline: substitution.decode → atob → split('').reverse().join('')
 *   3. Parse the plaintext question, compute the answer, submit via x-challenge-response
 *
 * The server keeps ONLY the plaintext answer for validation.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const reverse = s => s.split('').reverse().join('');

const encodeB64 = s => {
  const bytes = textEncoder.encode(s);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const decodeB64 = s => {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return textDecoder.decode(bytes);
};

// Printable ASCII 33-126 (94 chars) — safe for transport.
function printableAscii() {
  return Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i));
}

// Cryptographic Fisher-Yates shuffle over the alphabet so the cipher map is a
// fresh random bijection per challenge.
function generateCipherMap() {
  const chars = printableAscii();
  const shuffled = [...chars];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  const encodeMap = Object.fromEntries(chars.map((ch, i) => [ch, shuffled[i]]));
  const decodeMap = Object.fromEntries(shuffled.map((ch, i) => [ch, chars[i]]));
  return { encodeMap, decodeMap };
}

function substitute(text, map) {
  if (!map) return text;
  return text
    .split('')
    .map(c => map[c] ?? c)
    .join('');
}

export function decodeChallenge(ciphertext, meta = {}) {
  try {
    const pipeline = meta.pipeline || [];
    let text = ciphertext;
    for (let i = pipeline.length - 1; i >= 0; i--) {
      const step = pipeline[i];
      if (step === 'substitution') text = substitute(text, meta.substitutionMap);
      else if (step === 'base64') text = decodeB64(text);
      else if (step === 'reverse') text = reverse(text);
    }
    return text;
  } catch {
    return '';
  }
}

// ---------- generators (pure, no eval) ----------

const ops = ['+', '-', '*'];

const mathGenerators = [
  () => {
    const a = Math.floor(Math.random() * 50) + 1;
    const b = Math.floor(Math.random() * 50) + 1;
    const c = Math.floor(Math.random() * 10) + 1;
    const op1 = ops[Math.floor(Math.random() * ops.length)];
    const op2 = ops[Math.floor(Math.random() * ops.length)];
    let expr;
    let ans;
    if (op1 === '*' && op2 === '*') {
      expr = `(${a} * ${b}) + ${c}`;
      ans = a * b + c;
    } else if (op1 === '*') {
      expr = `${a} * (${b} + ${c})`;
      ans = a * (b + c);
    } else if (op2 === '*') {
      expr = `(${a} + ${b}) * ${c}`;
      ans = (a + b) * c;
    } else {
      expr = `${a} ${op1} ${b} ${op2} ${c}`;
      const step = op1 === '+' ? a + b : a - b;
      ans = op2 === '+' ? step + c : step - c;
    }
    return { question: `Calculate the result of: ${expr}`, answer: String(ans) };
  },
  () => {
    const a = Math.floor(Math.random() * 100) + 1;
    const b = Math.floor(Math.random() * 100) + 1;
    return {
      question: `Sum: ${a} + ${b}`,
      answer: String(a + b),
    };
  },
  () => {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    return {
      question: `Product: ${a} * ${b}`,
      answer: String(a * b),
    };
  },
];

const logicGenerators = [
  () => ({
    question: 'If all blocks are cubes and some cubes are red, can you conclude that some blocks are red?',
    answer: 'yes',
    options: ['yes', 'no', 'cannot be determined'],
  }),
  () => ({
    question: 'Ana is taller than Bruno. Bruno is taller than Carlos. Who is the tallest?',
    answer: 'ana',
    options: ['ana', 'bruno', 'carlos'],
  }),
  () => ({
    question: 'In a race, you overtake the second place. What position are you in?',
    answer: 'second',
    options: ['first', 'second', 'third'],
  }),
  () => ({
    question: 'You have 3 apples, eat 1 and give 1 to a friend. How many do you have left?',
    answer: '1',
    options: ['0', '1', '2', '3'],
  }),
  () => ({
    question: 'If it rains, the ground gets wet. The ground is wet. Did it rain?',
    answer: 'cannot be determined',
    options: ['yes', 'no', 'cannot be determined'],
  }),
  () => ({
    question: 'All roses are flowers. Some flowers fade quickly. Do all roses fade quickly?',
    answer: 'no',
    options: ['yes', 'no', 'cannot be determined'],
  }),
];

const reasoningGenerators = [
  () => ({
    question:
      'A train leaves Madrid at 100 km/h. Another leaves Barcelona at 120 km/h. The distance is 620 km. At what distance from Madrid do they meet? (Round to integer)',
    answer: '282',
  }),
  () => ({
    question: 'If you multiply my age by 3, subtract 6, and divide by 3, you get 18. What is my age?',
    answer: '20',
  }),
  () => ({
    question: 'Complete the series: 2, 6, 12, 20, 30, ?',
    answer: '42',
  }),
  () => ({
    question:
      'In a group of 30 people, 18 drink coffee, 15 drink tea, and 8 drink both. How many drink neither?',
    answer: '5',
  }),
  () => ({
    question:
      'A snail climbs 3 feet up a wall each day but slides down 2 feet each night. The wall is 10 feet high. How many days to reach the top?',
    answer: '8',
  }),
  () => ({
    question:
      'You have two ropes. Each burns for exactly 1 hour but at inconsistent rates. How do you measure 45 minutes?',
    answer:
      'Light both ends of rope 1 and one end of rope 2. When rope 1 finishes (30 min), light the other end of rope 2. It burns for 15 more min.',
    options: [
      'Light both ends of rope 1 and one end of rope 2...',
      'Light one rope...',
      'Cannot be done',
    ],
  }),
];

const ALL_GENERATORS = [
  ...mathGenerators.map(fn => ({ fn, type: 'math' })),
  ...logicGenerators.map(fn => ({ fn, type: 'logic' })),
  ...reasoningGenerators.map(fn => ({ fn, type: 'reasoning' })),
];

function pickRandomGenerator() {
  return ALL_GENERATORS[Math.floor(Math.random() * ALL_GENERATORS.length)];
}

export function generateChallenge(scenario = 'generic') {
  const { fn, type } = pickRandomGenerator();
  const base = fn();

  const { encodeMap, decodeMap } = generateCipherMap();
  const plaintext = base.question;
  // Forward pipeline: reverse → base64 → substitution.
  const ciphertext = substitute(encodeB64(reverse(plaintext)), encodeMap);

  return {
    type,
    ciphertext,
    plaintext,
    meta: {
      pipeline: ['reverse', 'base64', 'substitution'],
      substitutionMap: decodeMap,
    },
    answer: base.answer,
    options: base.options,
    scenario,
    difficulty: type === 'reasoning' ? 'high' : 'medium',
  };
}

// Strict: only the exact answer passes. Listing options must never let a
// machine pass by guessing another entry in the list.
export function validateResponse(challenge, response) {
  if (!challenge || response === undefined || response === null) return false;
  if (challenge.answer === undefined || challenge.answer === null) return false;
  const normalizedResponse = String(response).trim().toLowerCase();
  const normalizedAnswer = String(challenge.answer).trim().toLowerCase();
  return normalizedAnswer.length > 0 && normalizedResponse === normalizedAnswer;
}

export {
  reverse,
  encodeB64,
  decodeB64,
  generateCipherMap,
  substitute,
};