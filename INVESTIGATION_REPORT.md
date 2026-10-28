# OpenCode — Investigación estratégica y técnica de TollAI frente a la explotación hiperautomatizada por IA

> Fecha: 2026-10-24 | Repositorio: /home/andres/Documents/Proyects/TollAI | Rama: (git repo presente)  
> Estado: Solo lectura (sin modificaciones realizadas)

---

## 1. Executive Summary

**Qué es TollAI actualmente:** TollAI es un Proof of Concept (PoC) que implementa un "cognitive toll" con dos mecanismos principales que coexisten:
1. **PoW (Proof of Work) para navegadores**: El cliente JS (`tollai/client/tollai-client.js`) obtiene un desafío PoW desde `/tollai/challenge`, resuelve hashes SHA-256 hasta encontrar un nonce con `difficulty` bits en cero, lo verifica en `/tollai/verify` y recibe una cookie `tollai_session` firmada (HMAC-SHA256, formato `payload.signature`). Tras obtener sesión, hay "dwell" (heartbeat cada 500ms, cap 1000ms por beat) requerido para mutaciones POST, burst/rate-limiting por sesión, y refresh de sesión deslizante.
2. **Desafío de razonamiento ("433 challenge") para clientes no-browser**: Cuando no hay sesión válida y `looksLikeBrowser()` no puntúa suficientemente (ver criterios), el core emite un desafío obfuscado (pipeline `reverse → base64 → substitution` con mapa por desafío) vía status **433** con `challenge_id`, `ciphertext`, `meta`. El cliente debe resolverlo en **> 1500ms** (umbral configurable) y enviar `x-ai-proof` + `x-challenge-response` para validar. Si responde **< 1500ms** → **403 AI_AGENT_DETECTED (MACHINE_SPEED)**. Si acierta tras >=1500ms → crea sesión con `source: 'challenge'` (marcado en hooks).

**Qué funciona (CONFIRMADO):** 
- Flujo PoW para navegadores con atestación silenciosa (shell + reload). Sesión HttpOnly firmada con IP binding (HMAC del IP en hash almacenado en token).
- Desafío 433 con ofuscación multi-capa por solicitud. Detección por umbral de tiempo en verificación de desafío. Burst por sesión (`rateWindowMs`/`rateLimit`, contador en token) y por clave burst `b:<sid>`. Dwell para mutaciones POST. Protocol endpoints nunca pasan por política de "toll".
- 12 escenarios protegidos con `conditionalTollAI`. Dashboards (victima `/`, logs `/logs`, atacante en puerto 3001). Telemetría con persistencia opcional.
- Tests muestran efectividad contra el simulador por defecto (machine-speed): bloqueados 12/12 según README.

**Limitaciones principales (CONFIRMADO):**
- Desafíos de razonamiento son **deterministas** (generadores fijos). El solver local puede resolverlos con `eval` para matemáticas o mapeos directos. Un agente que espere deliberadamente >1500ms puede pasar el filtro de tiempo.
- Almacenamiento **in-memory** (Maps) — no distribuido. Sesiones/desafíos se pierden en reinicio.
- Dwell es **reportado por cliente** (capped 1000ms/beat), tratable como fricción.
- `looksLikeBrowser()` requiere UA tipo browser **Y** score >= 3 con señales (accept-language, Sec-Fetch-*, Sec-CH-UA). Clientes tipo `axios` fallan el chequeo y van por camino de desafío.
- IP binding estricta puede fallar con NAT/proxies; hay `IP_MISMATCH` → 403.
- Modo `observe` (shadow) registra decisiones pero no fuerza; `off` bypass completo.
- `failOpen: true` por defecto (en errores pasa sin forzar).

**Oportunidad:** Convertir señales dispersas en **scoring comportamental unificado** con trazabilidad completa, mejorar resiliencia del desafío (entropía/estado), y hacer observable el costo real (tokens medidos vs estimados) — sin pretender reemplazar parches/autenticación/aislamiento.


---

## 2. Architecture Map (basado exclusivamente en implementación)

### Componentes reales
**Core (`tollai/core/`)**
- `index.js` (`createToll`): orquestador. Gestiona modos (`gate|api|off|observe`), política, sesiones, desafíos 433, PoW, burst/quota/dwell, hooks (`onDecision`, `onAIAgentDetected`, `onSessionIssued`, `onDwellDeferred`), `failOpen`. Pre-session rate limiting por `ipHash` (store keys `pre:<ipHash>`), concurrent sessions per IP opcional, `exempt`, `autoCalibrate` por escenario/tipo.
- `protocol.js` (`createProtocol`): endpoints **nunca tolled** bajo `/tollai/*` — `/tollai/challenge` (PoW issue), `/tollai/verify` (PoW verify + mint sesión), `/tollai/dwell` (acumular dwell con cap), `/tollai/client.js` (serve clientSource), `/tollai/status`. Usa `ProofOfWork`, sesiones, dwell.
- `challenge.js`: generadores deterministas (`math`, `logic`, `reasoning`), pipeline ofuscación `reverse → base64 → substitution` con mapa por desafío, `validateResponse` estricta (lowercase, trim, comparación exacta).
- `pow.js`: `ProofOfWork` con firma HMAC del challenge, `leadingZeroBits`, single-use vía `MemoryStore.mark` (clave = `payload.id`), verificación ordenada.
- `session.js`: token firmado `v1`, `sid`, `ip` (hash), `iat/exp`, `dw` (dwell acumulado), `ws/wc` (ventana burst), `n`. `ipHashFor`, `createSession`, `issueToken`, `parseSession` (firma + formato + exp + IP binding), `refreshSession` (sliding), `registerRequest` (ventana deslizante, detecta burst), `accumulateDwell` (cap 1000ms/beat).
- `policy.js`: matcher con wildcards `*` y `**`, modos `off|gate|observe` tollan todo (salvo exclude), `api` usa `protect`.
- `http.js`: parsing cookies/headers, `looksLikeBrowser()` (UA browser + score>=3 con accept-language/Sec-Fetch*/Sec-CH-UA/accept html), `wantsHtml()`, `sessionCookie` HttpOnly SameSite Lax.
- `crypto.js`: WebCrypto HMAC-SHA256, `signPayload/verifySignature` (b64url + timingSafeEqual), `randomHex`.
- `shell.js`: página de atestación con spinner, carga `/tollai/client.js` y llama `TollAI.establish()` para recargar.
- `memory-store.js`: Map con expiración, límite `max`, purge por acceso.

**Adaptadores (`tollai/adapters/`)**
- `express.js`: `tollaiMiddleware` usa `runNode`. Copia `ctx` a `req.*` y `res.locals.tollai`.
- `node-http.js`: convierte req a Request, construye ctx via `nodeCtx` (respeta `req.tollMode==='unprotected'` → ctx.mode='off', respeta `req.tollScenario`), llama `toll.handle`, `mirrorContext`, `applyNodeOut`, `respondNode`. Solo lee body raw para `/tollai/verify` (o si pre-parsed lo re-serializa).
- `node-core.js`: helpers para IP/headers/contexto.

**Cliente (`tollai/client/`)**
- `client-source.js` (generado) / `tollai-client.js`: PoW SHA-256 síncrono en JS, obtiene `/tollai/challenge`, resuelve nonce, POST `/tollai/verify` → cookie, parchea `window.fetch` para rutas `/api/*` (auto-establecer sesión si falta, reintentos por 401/428 DWELL_REQUIRED con espera, reset+retry por expiración/capacidad), heartbeat dwell cada 500ms a `/tollai/dwell` (cap 1000ms), indicador UI.

**Servidor PoC (`server.js`)**
- Monta toll engine con hooks. Sirve `/tollai/challenge|verify|dwell|status|telemetry|stats|usage|attack-events` vía middleware. Middleware modo global (`x-tollai-mode`/query) con firma HMAC opcional si `TOLLAI_MODE_SECRET`. `conditionalTollAI(scenario)` aplica tollMw solo si modo `protected`, else bypass con metadata y telemetría `bypassed`. Sirve páginas con `serveTolledPage` inyectando `TOLLAI_SESSION=true` si `req.tollVerified` e inyectando `<script src="/tollai-client.js">`. 12 escenarios API + páginas protegidas/desprotegidas. Integración Ollama opcional para chatbot. Telemetría vía `lib/telemetry.js`.


### Flujo real

**A) Navegador accede a página tolled sin sesión**
1. Request llega a ruta protegida → `tollaiMiddleware`/`runNode` llama `toll.handle`.
2. Core detecta ruta protegida por política. Sin cookie válida → `handleFresh()`. `looksLikeBrowser()` true + `wantsHtml()` + GET → responde con **shell HTML** (200) vía `createShell` (no 401), con `X-TollAI-Decision: attestation-required`, `ctx.needsAttestation=true`.
3. Navegador carga `tollai-client.js`, ejecuta `boot()` → `establish()`: GET `/tollai/challenge` (protocol, no toll), resuelve PoW, POST `/tollai/verify` (recibe cookie HttpOnly), `window.TOLLAI_SESSION=true`, recarga página.
4. Segunda carga con cookie → sesión válida, `handleSession`: permite GET transparent; para POST verifica dwell >= minDwellMs y burst/quota; refresca cookie deslizante.

**B) Cliente no-browser (axios/curl) a API tolled sin sesión**
1. Sin cookie, `looksLikeBrowser()` false (UA axios, faltan señales) → `handleFresh()` va por camino **no-browser**: busca header `x-ai-proof`. Si no existe → `issueChallenge()` genera desafío obfuscado (id, ciphertext, meta con pipeline/substitutionMap), guarda en `records` con `ipHash`, `attempts=0`, TTL 60000ms, responde **433** con `X-TollAI-Decision: challenge-issued`.
2. Cliente decodifica (reverse→base64→substitution con decodeMap), resuelve pregunta, mide tiempo desde emisión? (cliente decide cuándo enviar; servidor mide `responseTime = now() - record.issuedAt` al recibir `x-challenge-response`).
3. `verifyChallenge()`: valida pre-session rate limit, existencia, IP binding, expiración, cuenta intentos. Si `responseTime < effectiveMinResponseTime` (default 1500ms, con autoCalibrate posible) → borra registro, `reportAgent('MACHINE_SPEED', {..., challengeType})`, responde **403** `AI_AGENT_DETECTED`. Si >= umbral y respuesta correcta y `attempts <= 3` → borra registro, crea sesión con `source: 'challenge'`, emite cookie, responde **200** con `X-TollAI-Decision: challenge-validated` (sin body JSON forzado en finalize cuando response null? En core, tras crear sesión retorna `finalize(null, 'challenge-validated', {...})` - en ese caso response es null; `finalize` retorna null si response===null y no es caso especial, pero setea headers/cookies. Ver flujo: `setSessionCookie` ya añadido a ctx.out; `finalize(null, ...)` devolverá null tras setear headers - el adapter aplicará `ctx.out` y llamará `next()`? Ver node-http: si response===null → `applyNodeOut(res,ctx); return next();` El servidor PoC añade cookie vía `setSessionCookie` al ctx.out, así que cookie se envía aunque finalize devuelva null.)
4. Con cookie de sesión (emitida por camino desafío), subsecuentes requests pasan por `handleSession` con las mismas reglas (dwell/burst/quota).

**Diferencias entre rutas protegidas/desprotegidas:** `conditionalTollAI` solo llama `tollMw` si `req.tollMode === 'protected'`. Si no, bypass directo (marca `bypassed`, añade metadata, emite telemetría). También hay endpoints `/unprotected/*` explícitos sin toll. El modo puede cambiarse por header/query con firma HMAC si `TOLLAI_MODE_SECRET` está seteado (verificación con timestamp ±60s).

**Rutas alternativas:** Protocol `/tollai/*` siempre van por `protocol()` antes de política - nunca tolled. Modo `off` bypass total. `exempt` callback/patrón puede bypass. `failOpen` pasa request en error.


---

## 3. Amenaza de agentes autónomos - Cobertura

| Amenaza | Middleware HTTP TollAI | App protegida | Agente/entorno/herramientas | ¿Resolvible con middleware genérico? | Evidencia |
|---|---|---|---|---|---|
| Descubrimiento automatizado de vulns | PARCIAL - puede frenar ráfagas/burst; no clasifica semántica de paths | SÍ - authz/rate por recurso | PARCIAL - headless puede evadir | PARCIAL | Burst/session quota, política por ruta. No hay análisis de intención. |
| Payloads variables/adaptativos | DÉBIL - desafío determinista | SÍ - validación estricta | NO - agente adapta | DÉBIL | Generadores fijos en `challenge.js`; ofuscación cambia por request pero preguntas conocidas. |
| Explotación masiva | SÍ - burst, quota, pre-session limits, concurrent per IP | SÍ | PARCIAL | SÍ (limitación/frenado) | `store.incr` con ventanas, `preSessionExceeded`, `checkMaxConcurrentSessions`. |
| Fuerza bruta/abuso credenciales | PARCIAL - fricción + burst | SÍ - bloqueo cuenta, MFA | NO | PARCIAL | TollAI no gestiona auth; puede ralentizar pero no sustituye. |
| Extracción automatizada secretos | PARCIAL - ralentiza masivo | SÍ - DLP, least privilege | NO | PARCIAL | Depende de exposición; podcast muestra caso derivado (ASR). |
| Prompt injection directa/indirecta | NO - fuera de alcance HTTP genérico | SÍ - sanitización, system prompts, allowlists | SÍ - aislamiento agente | NO razonablemente | Sin parsing semántico de prompts. |
| Manipulación agente via contenido remoto | NO | SÍ | SÍ - sandboxing | NO | Fuera de scope middleware. |
| Abuso curl/Python/Git | SÍ - via `looksLikeBrowser()` falla → desafío 433 + time check | PARCIAL | NO | SÍ | Confirmado por tests/simulador. |
| Alta velocidad solicitudes | SÍ - umbral tiempo + burst | SÍ | PARCIAL - puede añadir delays | SÍ (fricción) | `minResponseTime` en verificación desafío; burst counters. |
| Evasión por firmas | DÉBIL - UA/banderas pueden falsearse | SÍ - comportamiento | SÍ | DÉBIL | `looksLikeBrowser()` heurístico; headers manipulables. |
| Abuso endpoints modelos IA | PARCIAL - puede frenar; chatbot registra tokens | SÍ - quotas por usuario/clave, costo | NO | PARCIAL | `telemetry.recordLLM` registra consumo (Ollama medido si hay counters). |
| Exfiltración via requests/headers | NO - no inspección profunda semántica | SÍ - egress control | SÍ | NO | No hay DLP en middleware. |

**Fuentes primarias contrastadas (hipótesis vs hechos):** El concepto "velocidad como señal" tiene fundamento fisiológico, pero la implementación usa umbral fijo 1500ms medido en **servidor** como `(now() - record.issuedAt)` al recibir headers de respuesta al desafío 433 - **CONTRASTADO: medido en servidor, no en cliente**. PoW efectivo para forzar ejecución cliente; desafío de razonamiento determinista es evadible con delays. No se encontraron referencias a papers específicos en código; documentación cita MITRE ATT&CK T1588.002.


---

## 4. Auditoría del mecanismo de fricción

**Búsqueda mecanismos (CONFIRMADO):** Base64 (`encodeB64/decodeB64`), reverse, sustitución dinámica por desafío (`generateCipherMap`), challenge-response 433, **Proof of Work** (hashcash SHA-256 con dificultad bits cero), nonces, timestamps/iat/exp, expiración desafíos (60000ms), validación respuesta estricta, límites intentos (3), prevención replay (PoW single-use via store.mark por id; desafío 433 se borra tras validar o al fallar límites/expiración/IP), identificación cliente (IP hash), estado en Maps.

**Qué recibe el cliente:** Para no-browser sin sesión: `POST /api/*` o request sin sesión válido → 433 con `{challenge_id, ciphertext, meta:{pipeline, substitutionMap}, challenge_type, scenario, timestamp, expires_in}`. **NO** recibe pregunta en claro.

**Qué debe hacer:** Decodificar `ciphertext` aplicando inversa del pipeline usando `meta.substitutionMap` (substitution inversa, luego base64 decode, luego reverse) para obtener pregunta. Resolver pregunta. Enviar misma request con headers `x-ai-proof: <challenge_id>` y `x-challenge-response: <answer>` **tras >=1500ms** desde emisión.

**Validaciones servidor:** Pre-session rate limit, existencia registro, IP binding (`record.ipHash === ipHash`), expiración (`now - issuedAt > challengeTTL`), conteo intentos (`attempts>3` → MAX_ATTEMPTS), **umbral tiempo** (`responseTime < effectiveMinResponseTime` → MACHINE_SPEED/403), validación respuesta (`validateResponse` exacta case-insensitive trim). Tras éxito borra registro, crea sesión, emite cookie.

**Automatizable sin LLM:** **SÍ (CONFIRMADO)**. `toll-flows.js` extrae solucionador de `attackers/agent-simulator.js` (`_solveLocal`) usando `eval` para extraer función. Simulador resuelve math con `eval`, lógica/mapeos directos. Desafíos deterministas.

**Reutilizable/reproducible:** Desafío 433 es **single-use** (se borra al validar o al rechazar por límites). PoW single-use. Replay imposible con mismo registro. IP binding previene reenvío desde otro IP.

**Límites intentos:** `record.attempts > 3` → borra y responde MAX_ATTEMPTS 403. También pre-session rate limit global por IP hash.

**Omitir reto:** Sí - hay rutas alternativas. `/unprotected/*` sin toll. Modo `off` o header modo unprotected bypass. También endpoints que no estén bajo política `protect`/`conditionalTollAI`. Dashboards muestran ambas vías.

**Validación antes de respuesta protegida:** Sí - desafío validado antes de emitir cookie/sesión; solo con cookie válida pasa `handleSession` a siguiente capa.

**Concurrencia:** Cada request con mismo challenge_id compite por mismo registro (se borra al primer procesamiento). Registros en Map in-memory. Sin locking explícito visible pero JS single-threaded; race conditions teóricas posibles en lógica pero comportamiento observable es determinista.

**Impacto latencia/recursos:** PoW ~450ms cliente (dificultad 14). Validación PoW server rápida. Desafío 433 server genera pregunta trivial, validación barata. Almacenamiento in-memory. Pre-session counters en store.

**Protección real vs amenazas no cubiertas:** Protege contra scrapers rápidos sin JS que respondan instantáneamente. No protege contra agente que espera >1500ms deliberadamente. No protege contra navegador automatizado que ejecute cliente JS (Playwright puede ejecutar PoW/dwell). No sustituye authz/parches.

**¿Exige LLM?** **NO (CONFIRMADO)**. Puede resolverse con script determinista. Costo computacional cliente existe (PoW para browsers, CPU trivial para resolver math). **Costo inferencia LLM: CERO requerido** - opcional en simulador/attacker para modo "slow LLM" (medido por README puede pasar umbral si espera). **Costo económico real favorece defensor solo si obliga a LLM caro** - con implementación actual NO es así. Asimetría no demostrada; requeriría desafíos no-resolubles por código + verificación cara.


---

## 5. Detección por velocidad (latencia)

**Umbrales:** `minResponseTime` por defecto 1500ms. Aplicado en `verifyChallenge` como `responseTime = now() - record.issuedAt` comparado con `effectiveMinResponseTime` (autoCalibrate puede ajustar por escenario/tipo usando `timeProfile`). También mencionado 500ms/1500ms en README como hipótesis - **valores son configurables, no hardcodeados fijos**.

**Dónde se mide:** **Servidor**. `record.issuedAt = now()` al emitir desafío; `responseTime = now() - record.issuedAt` al verificar. **NO** confía en timestamp cliente.

**Tiempo de respuesta/resolución/desafío/total:** Mide tiempo desde emisión desafío hasta recepción verificación (incluye red + procesamiento cliente). No mide "dwell" en este path - dwell aplica a sesiones válidas para mutaciones.

**Manipulable:** Cliente puede retrasar envío deliberadamente (sleep). Servidor no puede distinguir "pensando" vs "durmiendo". Timestamp servidor es autoritativo.

**Replay:** Desafío borrado tras primer intento de verificación exitoso/fallido por límites; IP binding; expiración. PoW single-use.

**Falsos positivos/negativos:** FP si humano con latencia alta/respuesta lenta. FN si bot con delays artificiales > umbral. Red variable afecta.

**Evasión con delays:** **SÍ (CONFIRMADO)** - README indica agente lento con LLM puede pasar. Simulador por defecto es machine-speed (<500ms target) y es bloqueado.

**Navegadores automatizados:** Pueden ejecutar cliente JS (PoW + dwell). Si obtienen sesión válida, bypassan camino desafío 433.

**Agentes con código determinista:** Pueden resolver localmente pero deben esperar >1500ms si usan camino desafío.

**Combinación señales (viabilidad):** 
- Frecuencia/conciencia (burst counters existen)
- Concurrencia (maxConcurrentSessionsPerIp opcional)
- Patrones repetición (no explícito)
- Secuencias endpoints (no explícito)
- Errores auth/desafíos (registrados)
- Fallos desafíos (registrados)
- Identidad/sesión (IP binding, session tokens)
- Consistencia comportamiento (no explícito)
- Coste/sensibilidad operación (scenarios definidos)

**Actual:** Burst, dwell, quota, IP binding, umbral tiempo, pre-session limits. **Futuro:** scoring unificado, análisis secuencial, reputación.

**Recomendación:** No bloquear solo por velocidad. Combinar señales con pesos, considerar contexto (operación sensible), medir FP/TP.


---

## 6. Dashboards

### A. Dashboard víctima (`/`, `tollai-dashboard.html`)
**Activación/desactivación:** Control por modo vía header/query `x-tollai-mode`/`tollai_mode` (protegido|desprotegido). En UI hay botón toggle. Estado persiste solo en request/contexto; servidor guarda modo en `req.tollMode`. **Persistencia:** NO hay persistencia global en core - es por request/header. En PoC control manual.
**Backend usa estado:** Sí - `conditionalTollAI` y `tollModeMiddleware` aplican lógica. `nodeCtx` pasa `ctx.mode = 'off'` si `req.tollMode==='unprotected'`.
**Diferencia real ON/OFF:** Sí - ON aplica tollMw (puede emitir desafíos/shell/bloquear); OFF bypassa middleware toll, añade metadata bypassed, emite telemetría. También existen rutas `/unprotected/*` directas.
**Evasión por otra ruta:** Sí - usar `/unprotected/*` o cambiar modo.
**UI vs backend:** UI muestra estado; backend autoritativo. Posibles inconsistencias si modo se cambia dinámicamente.

**Métricas mostradas:** Estadísticas desde telemetría (total requests, blocked, admitted/transparent, pow paid, dwell deferred, challenges). Ver `public/tollai-dashboard.html` (521 líneas) - muestra contadores en tiempo real.

### B. Dashboard atacante (`attacker-config.js` puerto 3001, `public/attacker/*`)
**Endpoints:** Usa API propia en puerto 3001 (`/api/attack/start`, `/api/ollama/models`, etc.). Lanza `attackers/agent-simulator.js` como proceso hijo.
**Envío requests:** Simulador usa axios con headers tipo agente; sigue flujo desafío 433.
**Headers:** `User-Agent` agente, `x-ai-proof`, `x-challenge-response`.
**Resolución desafíos:** Decodifica con `decodeChallenge` (importa de `tollai/core/challenge.js`), resuelve con `_solveLocal` o Ollama.
**Información mostrada:** Progreso paso a paso, challenge recibido, respuesta, resultado 403/200, tiempos, resumen campaña.
**Comparación ON/OFF:** Puede atacar contra target configurable; usar rutas unprotected/manualmente. No hay comparación automática integrada.
**Diferencia vs cliente externo:** Mismo protocolo HTTP; ejecuta desde mismo host/red.

### C. Dashboard logs (`/logs`, `logs-dashboard.html`)
**Registra:** IP, cliente, UA, método, path, modo, escenario, decisión, señal, requestId, latencia, detalle (dwell/response time/challenge type), tipo evento (request/proof/llm/attack/dwell). Telemetría guarda eventos (max 1000 in-memory), contadores, LLM usage.
**Métricas tiempo:** `latencyMs` en decisiones core, tiempos PoW/verify, dwell. `durationMs` Ollama.
**Tokens:** `recordLLM` guarda prompt/completion/total, fuente, medido/estimado. Se marca `measured` si Ollama reporta counters.
**Pérdida información:** Si telemetría no captura (modo observe? decisiones se graban pero comportamiento diferente), hooks opcionales. También eventos bajo `/tollai/*` reservados pueden no ir por mismo path telemetría. Logs consola separados (SOC alerts) via `onAIAgentDetected`.

**Trazabilidad:** `requestId` generado (`randomHex(8)`) propagado en headers `x-request-id`. Correlación parcial.


---

## 7. Trazabilidad y métricas

**Reconstruir solicitud:** Parcialmente posible con `requestId`, `ip`, `timestamp`, logs telemetría. Estados: recibido (telemetría), evaluado (decisión), permitido/bloqueado (decisión), enviado a víctima (solo si pasa middleware y llega a handler), respuesta entregada (no siempre trazado explícitamente).

**Correlation ID:** `requestId` existe. No hay trazado distribuido completo entre componentes.

**Medición independiente:**
- Latencia entrada: parcial (inicio en core)
- Evaluación seguridad: `latencyMs` total decisión
- Resolución desafío: `workMs` PoW, `responseTimeMs` desafío 433
- Comunicación con víctima: no medido explícitamente
- Procesamiento víctima: no medido
- Latencia total: no desagregado completamente

**Datos faltantes:** Tiempos red cliente-servidor, tiempo handler app, tiempo respuesta, breakdown completo.

**Tokens:** 
- **Consumidos por modelo:** Ollama reporta `prompt_eval_count`, `eval_count` → guardados como `measured: true`
- **Estimados:** `usage.estimated` o sin counters → marcado como no medido
- **Caracteres/bytes:** NO usados como "tokens"
- **Unidades dificultad desafío:** NO son tokens
- **Tokens auth:** NO

**Persistencia tokens:** Sí si Ollama provee métricas. Si no hay modelo, se registran valores sintéticos marcados como no medidos (server.js línea ~474-516, telemetría).


---

## 8. Compatibilidad con agentes y clientes locales

**Pruebas seguras realizadas (lectura código + lógica):** Basado en implementación:
- `curl`/`axios`/Python requests → `looksLikeBrowser()` falla → camino desafío 433
- Navegador normal → shell + PoW
- Playwright/Puppeteer → UA headless detectado en `identifyClient` (telemetría) pero `looksLikeBrowser()` depende de señales; puede ejecutar JS
- OpenCode/Antigravity/Kilo Code/VS Code → dependen de cliente HTTP usado (fetch nativo vs curl wrapper)

**Por qué funciona en dashboard pero falla desde cliente local:**
1. Cliente no conecta - red/bind (server escucha 0.0.0.0 implícito por Express)
2. Pasa por otro path - usar rutas correctas
3. Rechazado en desafío - responde muy rápido o mal decodificado
4. Falla comunicación con víctima - tras pasar toll
5. No aparece en logs - filtrado
6. Respuesta llega pero cliente no interpreta - headers/cookies

**Requisitos desafío:** Decodificar ofuscación, esperar >1500ms, headers correctos, IP consistente, no exceder intentos/expiración.

**Limitación:** No se pudieron ejecutar agentes locales en este entorno; conclusiones basadas en código.


---

## 9. Auditoría de seguridad de la propia implementación

**Revisado:**
- Autenticación/autorización: Sin auth de usuarios en PoC; control por sesión TollAI + IP binding
- Acceso entre víctimas/atacantes: Separados por puertos (3000/3001)
- Endpoints admin: `/tollai/telemetry`, `/tollai/stats`, `/tollai/attack-events` expuestos sin auth fuerte (attack-events tiene secret opcional)
- Validación entradas: Parcial - headers validados, body JSON parseado, respuestas desafío validadas estrictamente
- Secretos: Usa `TOLLAI_SECRET` o genera efímero con warning; `MODE_SWITCH_SECRET` opcional; `TOLLAI_ATTACK_SECRET` opcional
- Replay: Prevenido (PoW single-use, desafío borrado, sesión con exp)
- Rate limiting: Pre-session, burst sesión, quota sesión, PoW store
- DoS: In-memory sin persistencia, sin límites globales estrictos
- Abuso desafíos: Intentos limitados, IP binding, expiración
- Race conditions: Posibles teóricas
- Manejo errores: `failOpen` por defecto puede pasar requests en error
- Fugas info: Mensajes detallados (códigos/razones) útiles para debugging - riesgo info disclosure
- CORS: No configurado explícitamente
- Headers confianza: Usa `x-forwarded-for`/`x-real-ip` vía helpers
- SSRF: No hay rutas que hagan requests a destinos configurables por usuario
- Dependencias: Express, axios (dev), Node >=14
- Desactivar protección sin auth: Sí vía modo/header sin secret configurado

**Controles ausentes:** Authn/z robusta, CORS restrictivo, rate limiting global distribuido, logging seguro, validación más estricta.


---

## 10. Estrategia de defensa adaptativa (evaluación)

| Capacidad | Problema resuelve | Ya implementado | Evidencia | Falta | Complejidad | Riesgos/limitaciones | Dependencias | Criterios aceptación | Prioridad |
|---|---|---|---|---|---|---|---|---|---|
| A) Adaptive Challenge | Mismo reto a todos | PARCIAL | Tipos por generador, `autoCalibrate`, escenarios | Selección por riesgo, dificultad adaptativa | Media | Puede aumentar FP | Scoring, telemetría | Desafío varía con riesgo, no rompe humanos | ALTA |
| B) Behavioral Risk Scoring | Señales aisladas | PARCIAL | Burst, dwell, velocidad, sesión | Scoring unificado, pesos, historial | Media-Alta | Calibración, FP | Todas señales + almacenamiento | Score 0-100, decisiones mapeadas | ALTA |
| C) Policy Enforcement | Lógica dispersa | PARCIAL | Política, modos, exempt | Motor declarativo, evaluación centralizada | Media | Complejidad configuración | Policy engine | Políticas por recurso/acción | ALTA |
| D) Abuse Prevention | Abuso endpoints | PARCIAL | Burst/quota/pre-session | Límites granulares, sliding windows distribuidos | Media | Redis para multi-instancia | Store distribuido | Límites efectivos multi-nodo | ALTA |
| E) Request Traceability | Debugging | PARCIAL | requestId, telemetría | Correlation completo, spans, export | Media | Storage | Tracing | Trazado end-to-end verificable | ALTA |
| F) Attack Simulation | Pruebas comparativas | PARCIAL | Simulador, dashboards | Automatizado ON/OFF, reportes | Baja-Media | Aislamiento | Tests | Comparativas reproducibles | MEDIA-ALTA |
| G) Agent-Aware Security | Detección agentes | PARCIAL | Heurísticas | Señales múltiples, evitar fingerprinting frágil | Media-Alta | FP/privacidad | Scoring | Mejora TP sin romper browsers | ALTA |
| H) Secret/Data Protection | Exfiltración | NO/PARCIAL | Casos podcast | DLP básico, allowlists, monitoreo | Alta | Difícil genérico | Inspección contenido | Alertas exfiltración | MEDIA-ALTA |
| I) Operational Observability | Métricas | PARCIAL | Telemetría | Latencias desagregadas, FP/TP, costos | Media | Instrumentación | Métricas | Dashboards accionables | ALTA |


---

## 11. Matriz de pruebas reproducibles (propuesta)

| ID | Escenario | Objetivo | Precondiciones | Pasos | Resultado esperado | Métricas | Evidencia | Riesgo FP | Estado |
|---|---|---|---|---|---|---|---|---|---|
| T01 | ON/OFF comparación | Diferencia real | Servidor corriendo | Usar /api/news protegido vs /unprotected/news | Comportamientos distintos | Status/códigos/headers | Logs+responses | Bajo | Pendiente |
| T02 | Humano navegador | Flujo normal | Sin sesión | Navegar /news, esperar PoW | Acceso transparente | Tiempos PoW, cookie | Network+logs | Bajo | Parcialmente probado (tests) |
| T03 | Agente rápido | Bloqueo | Sin sesión | axios GET /api/news, resolver desafío <1500ms | 403 AI_AGENT_DETECTED | response_time_ms | Response | Bajo | Probado (simulador) |
| T04 | Agente lento | Posible bypass | Sin sesión | Resolver desafío con delay >1500ms | 200/403 según validación | Tiempos | Response | Medio | Pendiente |
| T05 | Replay desafío | Prevención | Desafío obtenido | Reusar x-ai-proof tras éxito | Rechazado/fallo | Códigos | Response | Bajo | Pendiente |
| T06 | Desafío expirado | Expiración | Esperar >TTL | Enviar tras 60s | CHALLENGE_EXPIRED | Status | Response | Bajo | Pendiente |
| T07 | Múltiples intentos | Límite | Mismo challenge_id | 4 intentos incorrectos | MAX_ATTEMPTS | Códigos | Response | Bajo | Pendiente |
| T08 | Burst sesión válida | Burst | Cookie válida | 50 req rápidas paralelas | BURST_RATE 403 | Conteo | Responses | Medio | Parcialmente probado |
| T09 | POST sin dwell | Dwell | Sesión sin dwell | POST sin heartbeats | DWELL_REQUIRED 428 | dwell_ms | Response | Medio | Pendiente |
| T10 | IP mismatch | Binding | Cookie otro IP | Usar cookie cross-IP | IP_MISMATCH 403 | Status | Response | Medio | Pendiente |
| T11 | curl local | Compatibilidad | Sin JS | curl a API protegida | 433 o comportamiento esperado | Flujo completo | Logs | Bajo | Pendiente |
| T12 | PoW navegador | Atestación | Sin sesión browser-like | GET página + ejecutar cliente | Cookie + acceso | Tiempos | Network | Bajo | Parcialmente probado |
| T13 | Víctima caída | Resiliencia | App caído | Request tras toll | Comportamiento definido | Errores | Logs | Bajo | Pendiente |
| T14 | Alta concurrencia | Performance | Load | Paralelo masivo | Sin crash, límites aplicados | Latencia/errores | Métricas | Bajo | Pendiente |


---

## 12. Plan de evolución por fases

### Fase 1: Corregir y demostrar lo existente (CRÍTICA)
- **Intercepción efectiva:** Verificar todas rutas protegidas pasan por toll
- **ON/OFF diferencias:** Documentar y probar rutas /unprotected vs protegidas
- **Integridad desafíos:** Validar decodificación, expiración, intentos, IP binding
- **Trazabilidad:** Mejorar requestId propagation
- **Logs/métricas:** Asegurar captura completa decisiones
- **Compatibilidad clientes:** Probar curl/axios/Python
- **Seguridad básica:** Revisar endpoints expuestos, failOpen

**Criterios:** Tests reproducibles pasan, diferencias demostrables

### Fase 2: Convertir en capa medible
- **Políticas adaptativas:** Por escenario/sensibilidad
- **Detección abuso:** Unificar burst/quota/concurrencia
- **Rate limiting distribuido:** Redis backend
- **Correlation IDs:** End-to-end
- **Métricas latencia desagregadas:** Por fase
- **Motivos bloqueo:** Estandarizar códigos
- **Simulación ataques:** Automatizada ON/OFF
- **Comparativas:** Métricas objetivas

### Fase 3: Diferenciación
- **Desafíos adaptativos/no deterministas:** Reducir resolubilidad por código
- **Detección comportamiento anómalo:** Scoring ML-lite
- **Protección datos:** Controles exfiltración
- **Alertas:** Integración SIEM
- **Evaluación continua FP/TP:** Métricas
- **Resistencia agentes:** Pruebas reproducibles

**Nota:** No todas fases necesarias simultáneamente. Priorizar Fase 1.


---

## 13. Verdict Final

### 1) ¿Qué hace TollAI realmente hoy?
TollAI es un PoC de "cognitive toll" con **dos caminos**: PoW para navegadores (atestación silenciosa + sesión + dwell/burst) y **desafío de razonamiento obfuscado 433** para clientes no-browser con **detección por umbral de tiempo (servidor)**. Implementa sesiones firmadas con IP binding, política por ruta, telemetría, 12 escenarios, dashboards. **CONFIRMADO.**

### 2) ¿Qué amenazas puede mitigar con evidencia?
- Scrapers rápidos sin JS que responden instantáneamente al desafío 433: **SÍ** (bloqueados por MACHINE_SPEED)
- Ráfagas/burst desde sesión válida: **SÍ** (BURST_RATE)
- Acceso masivo sin sesión: **SÍ** (fricción + límites)
- Automatización básica curl/axios: **SÍ** (va por camino desafío)

**Evidencia:** Código core + simulador + tests `toll-flows.js`.

### 3) ¿Qué amenazas no puede mitigar?
- Agentes que **esperan deliberadamente >1500ms** antes de responder: **NO** (pueden pasar)
- Navegadores automatizados que **ejecuten cliente JS completo** (PoW+dwell): **PARCIAL/NO** si obtienen sesión
- Agentes con LLM lento adaptativo: **NO** según README
- Ataques con credenciales válidas: **NO** (fuera alcance)
- Prompt injection/exfiltración semántica: **NO**
- Explotación aplicación (RCE/SQLi): **NO** - solo capa HTTP
- Ataques distribuidos sofisticados: **PARCIAL**

### 4) ¿El mecanismo de fricción aumenta realmente el coste del atacante?
**PARCIALMENTE.** PoW aumenta costo para navegadores. Desafío 433 **NO aumenta costo de inferencia LLM** - resoluble por código determinista. Añade fricción temporal si se requiere espera, pero atacante puede automatizar espera. **No hay asimetría económica demostrada.** Requiere desafíos no-resolubles por código o costo de verificación caro.

### 5) ¿Es válido utilizar latencia como indicador de automatización?
**PARCIALMENTE VÁLIDO** como **una señal** entre muchas. Medición en servidor es correcta (autoritaria). Umbral fijo 1500ms es heurístico. Vulnerable a delays artificiales. Genera FP/FN. **NO debe usarse como único criterio.**

### 6) ¿El middleware puede ser omitido?
**SÍ (CONFIRMADO).** Rutas `/unprotected/*`, modo `off`/header unprotected, endpoints fuera de política `protect`, bypass por `exempt`. También posible si middleware no montado.

### 7) ¿Los dashboards reflejan el comportamiento real?
**PARCIALMENTE.** Telemetría captura decisiones core. Existen modos bypass que se registran. Pueden haber diferencias entre UI estado y efectivo. Logs muestran lo que telemetría captura.

### 8) ¿Existe trazabilidad completa?
**NO.** `requestId` existe pero correlación entre fases incompleta, latencias no desagregadas completamente, trazado víctima no detallado.

### 9) ¿Qué impide usar agentes locales?
Principalmente **lógica de detección**: `looksLikeBrowser()` false → camino desafío 433 + verificación tiempo/headers. También IP binding, cookies. No es "local vs remoto" sino **huella de cliente**. Agente puede simular headers browser + ejecutar JS.

### 10) ¿Cuáles son las tres mejoras de mayor impacto?
1. **Scoring comportamental unificado** - Combinar todas señales con pesos, reducir dependencia umbral único
2. **Desafíos no-deterministas/resistentes a código** - Aumentar costo para resolución automática
3. **Trazabilidad end-to-end + métricas desagregadas** - Correlation IDs, latencias por fase, FP/TP medibles

### 11) ¿Qué debemos demostrar antes de comercializar como capa de seguridad adaptativa?
- **Efectividad medible** contra agentes reales con delays adaptativos
- **Baja tasa FP** con tráfico humano legítimo
- **Resistencia a evasión** (headers spoofing, ejecución JS)
- **Trazabilidad completa** para investigación
- **Integración distribuida** (Redis) para producción
- **Separación clara** "detección vs mitigación" vs reemplazo controles
- **Métricas objetivas** FP/TP/costo


---

## 14. Evidence Appendix

| Hallazgo | Archivo | Función/Clase | Endpoint | Evidencia | Prueba ejecutada | Resultado | Limitaciones |
|---|---|---|---|---|---|---|---|
| Doble camino (PoW + 433) | `tollai/core/index.js:129,385,408` | `toll()`, `handleFresh()`, `issueChallenge()`/`verifyChallenge()` | `/api/*`, `/tollai/*` | `looksLikeBrowser()` divide caminos; 433 emite ciphertext | Lectura código + análisis flujo | CONFIRMADO | - |
| Ofuscación desafío | `tollai/core/challenge.js:1-251` | `generateChallenge()`, `decodeChallenge()`, `validateResponse()` | - | Pipeline reverse→base64→substitution, mapa por desafío | Lectura código | CONFIRMADO | Determinista |
| Umbral tiempo servidor | `tollai/core/index.js:487-518` | `verifyChallenge()` | - | `responseTime = now() - record.issuedAt < effectiveMinResponseTime` → MACHINE_SPEED | Lectura código | CONFIRMADO | Medido servidor |
| PoW cliente | `tollai/client/client-source.js:97-147` | `solvePow()`, `establish()` | `/tollai/challenge`, `/tollai/verify` | SHA-256 síncrono, dificultad bits cero | Lectura código | CONFIRMADO | - |
| Dwell | `tollai/core/session.js:82-91`, `tollai/client/client-source.js:190-206` | `accumulateDwell()`, heartbeat | `/tollai/dwell` | Cap 1000ms/beat, requerido POST | Lectura código | CONFIRMADO | Client-reported |
| Burst/Quota | `tollai/core/index.js:309-382`, `tollai/core/session.js:65-80` | `handleSession()`, `registerRequest()` | - | Contadores por sesión/ventana | Lectura código | CONFIRMADO | - |
| IP binding | `tollai/core/session.js:6,34-57`, `tollai/core/index.js:271-280` | `ipHashFor()`, `parseSession()` | - | Comparación ipHash, IP_MISMATCH 403 | Lectura código | CONFIRMADO | Problemas NAT |
| Modo bypass | `server.js:345-415`, `tollai/adapters/node-core.js:59-69` | `tollModeMiddleware()`, `conditionalTollAI()`, `nodeCtx()` | `/unprotected/*`, headers | Bypass completo con metadata | Lectura código | CONFIRMADO | Sin auth si no hay secret |
| Telemetría tokens | `server.js:469-517`, `lib/telemetry.js` | `getOllamaResponse()`, `recordLLM()` | `/api/chat`, `/tollai/usage` | Ollama counters medidos o sintéticos marcados | Lectura código | CONFIRMADO | - |
| Simulador evasión | `attackers/agent-simulator.js:200-290` | `attackScenario()`, `_solveLocal()` | Todos escenarios | Decodifica, resuelve local, headers desafío | Lectura código | CONFIRMADO | Determinista |
| Tests flujo | `test/toll-flows.js:1-230` | - | Múltiples | Verifica humano vs agente | Lectura código | CONFIRMADO | Requiere servidor corriendo |

**Git:** Repositorio git presente en `/home/andres/Documents/Proyects/TollAI/.git` - sin modificaciones realizadas durante investigación.

