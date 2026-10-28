export function createTimer() {
  const start = Date.now();
  const marks = { ingress: start };
  return {
    mark(name) {
      marks[name] = Date.now();
      return marks[name];
    },
    measure(from, to) {
      if (!marks[from] || !marks[to]) return null;
      return marks[to] - marks[from];
    },
    getTimings() {
      const t = {};
      const order = ['ingress', 'evaluation', 'challenge_issued', 'challenge_resolution', 'pow_verify', 'session_handling', 'response_prep', 'response'];
      for (let i = 1; i < order.length; i++) {
        const from = order[i-1];
        const to = order[i];
        if (marks[from] && marks[to]) {
          t[`${from}To${to}Ms`] = marks[to] - marks[from];
        }
      }
      if (marks.ingress && marks.response) {
        t.totalMs = marks.response - marks.ingress;
      } else if (marks.ingress) {
        t.totalMs = Date.now() - marks.ingress;
      }
      return t;
    },
    marks
  };
}

export default createTimer;
