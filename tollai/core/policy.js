const REGEX_SPECIAL = /[.+^${}()|[\]\\]/;

function segmentSource(segment) {
  let out = '';
  for (const ch of segment) {
    out += REGEX_SPECIAL.test(ch) ? `\\${ch}` : ch;
  }
  return out;
}

function patternToSource(pattern) {
  const segments = String(pattern).split('/');
  const parts = [];
  let trailingDoubleStar = false;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === '') continue;
    if (segment === '**') {
      if (i === segments.length - 1) {
        trailingDoubleStar = true;
        continue;
      }
      parts.push('.*');
      continue;
    }
    parts.push(segment === '*' ? '[^/]*' : segmentSource(segment));
  }

  if (parts.length === 0) return trailingDoubleStar ? '^.*$' : '^/$';
  let source = '';
  for (const part of parts) source += `/${part}`;
  if (trailingDoubleStar) source += '(?:/.*)?';
  return '^' + source + '$';
}

export function compilePatterns(patterns = []) {
  return patterns.map(pattern => new RegExp(patternToSource(String(pattern))));
}

export function matchPath(compiled, path) {
  for (const regex of compiled) {
    if (regex.test(path)) return true;
  }
  return false;
}

export function createPolicy({ mode = 'api', protect = ['/api/*'], exclude = [] } = {}) {
  const compiled = compilePatterns(protect);
  const excluded = compilePatterns(exclude);
  return {
    mode,
    shouldToll(path) {
      if (matchPath(excluded, path)) return false;
      if (mode === 'off') return false;
      if (mode === 'gate') return true;
      return matchPath(compiled, path);
    },
  };
}

export function createScenarioMatcher(table = []) {
  const entries = Array.isArray(table)
    ? table
    : Object.entries(table).map(([pattern, scenario]) => ({ pattern, scenario }));
  const compiled = entries.map(entry => ({
    regex: new RegExp(patternToSource(String(entry.pattern))),
    scenario: entry.scenario,
  }));
  return path => {
    for (const { regex, scenario } of compiled) {
      if (regex.test(path)) return scenario;
    }
    return 'generic';
  };
}