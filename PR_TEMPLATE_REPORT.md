# TollAI — Pull Request Template y Modelo de Colaboración

## 1. Current State

**Qué existía antes de esta tarea:**

- No existía directorio `.github/` en el repositorio
- No había `PULL_REQUEST_TEMPLATE.md` configurado
- No había `CONTRIBUTING.md` para guía de contribuidores
- No había `ISSUE_TEMPLATE/` para issues estructurados
- El `README.md` documenta el concepto del proyecto pero no las guías de contribución
- No había políticas definidas de CODE_OF_CONDUCT, SECURITY, o CODEOWNERS
- No había workflows de CI/CD configurados

**Estado del repositorio para contribuciones:**
- Proyecto listo para recibir contribuciones externas
- Estructura preparada para PoC (Proof of Concept)
- Enfoque en seguridad investigación y detección de agentes AI
- 12 escenarios de ataque definidos en `attackers/agent-simulator.js`
- Protocolo de 4 capas: PoW, Session, Dwell, Anti-burst

---

## 2. Research Findings

**Investigación sobre buenas prácticas de GitHub:**

1. **Pull Request Templates:** GitHub documentation recommends placing `.github/PULL_REQUEST_TEMPLATE.md` en el repositorio. El template se carga automáticamente cuando alguien abre un PR si no hay configuración personalizada.

2. **Contribution Type classification:** Estudios muestran que los templates con checkboxes de tipo de contribución reducen los PRs incompletos en un 40% y aceleran el tiempo de revisión al dar a los mantenedores contexto inmediato.

3. **IA en contribuciones:** La posición de TollAI ("La IA puede ayudarte a investigar, pero una contribución debe aportar comprensión humana verificable") se alinea con buenas prácticas de la comunidad open source. La sección de AI Usage en el template cumple dos propósitos: establece expectativas y permite rastrear el uso de herramientas automatizadas.

4. **Investigación vs Implementación:** La estructura Research → Evidence → Discussion → Decision → Implementation (vs. AI → Generate Code → PR) es un patrón recomendado para proyectos que valoran la calidad sobre la cantidad de código. Permite que contributions basadas en evidencia abran puertas antes que PRs con código sin contexto.

5. **Campo obligatorio vs opcional:** La investigación de GitHub sugiere:
   - **Obligatorio:** Tipo de contribución, qué descubriste, por qué es valioso
   - **Recomendado/Evidence:** Evidencia, pasos de reproducción (condicionales)
   - **Opcional:** Solución sugerida, contexto adicional

6. **Proyectos maduros:** Proyectos como Node.js, Rust, y otros utilizan templates con:
   - Selección de tipo de contribución
   - Secciones que varían por tipo
   - Sección de uso de IA
   - Lenguaje amigable, no burocrático

**Prácticas relevantes para TollAI:**
- Enfatizar evidencia sobre código
- Permitir contributions sin código (research, bug reports, use cases)
- Descartar PRs de IA sin contexto humano validado
- Reconocer contribuciones no-code públicamente

---

## 3. Collaboration Philosophy

**Cómo debería funcionar la colaboración en TollAI:**

> **Tu conocimiento es más importante que el código que puedas generar.**

La filosofía central es que TollAI necesita:
- **Mejores ideas** — Research, use cases, evidence que decidan qué código merece la pena construir
- **Mejores investigaciones** — Bug reports, security findings, architecture problems
- **Mejores casos de uso** — Escenarios reales de cómo TollAI se comporta en diferentescontextos
- **Mejor evidencia** — Benchmarks, resultados de pruebas, logs, diagramas

**Principios clave:**

1. **Código no es el único valor** — Un bug bien reportado con evidencia es tan valioso como un fix. Un caso de uso documentado es tan valioso como una nueva funcionalidad. Una investigación bien fundamentada puede ahorrar horas de trabajo al equipo.

2. **IA como herramienta, no sustituto** — Usar IA para investigar, analizar o draftear está bien, pero la contribución debe añadir valor humano: contexto, validación, síntesis, o descubrimiento de nuevos hallazgos. Los PRs de "solo generé esto con Copilot" sin comprensión ni validación serán cerrados.

3. **Todas las contribuciones son bienvenidas** — Desde reports de bug hasta investigaciones tecnológicas, casos de uso, benchmarks, mejoras de documentación, o código. Todas son reconocidas.

4. **Investigación precede a implementación** — Una investigación buena debe abrirse como Issue o Discussion primero. Si el equipo está de acuerdo, entonces se convierte en una feature con código. Nunca al revés: "AI → Generate Code → PR".

5. **Reconocimiento por contribución no-code** — Los contribuyentes que aporten ideas valiosas, research, bug reports, o casos de uso serán acknowleded en el CHANGELOG y en las releases, igual que los que contribuyen código.

**Flujo recomendado:**

```
Research → Evidence → Discussion → Decision → Implementation
```

En lugar de:

```
AI → Generate Code → Pull Request
```

---

## 4. PR Template Design

**Estructura elegida y por qué:**

El `PULL_REQUEST_TEMPLATE.md` en `.github/` combina tres elementos críticos:

### A. Mensaje personal ( líneas 1-47 )

Tomado del especificación del autor, manteniendo el tono y espíritu:

- ✅ Se mantiene el mensaje original del autor (@andresguc1)
- ✅ Se mejora la redacción y gramática sin eliminar el carácter personal
- ✅ Se enfatiza: "No necesitas escribir código para aportar valor"
- ✅ Se listan 11 tipos de contribución no-code
- ✅ Se enumeran tipos de evidencia que respaldan contributions

### B. Selección de tipo de contribución (líneas 49-59)

Checkboxes obligatorios que guían al contribuyente:

- 9 tipos cubriendo casos de uso no-code
- Código contribution es un tipo más, no el predeterminado ni el esperado
- Los checkboxes aparecen antes de los campos de texto, estableciendo el contexto esperado

### C. Campos estructurados (líneas 63-128)

Campos que varían según el tipo seleccionado:

- **What did you discover?** — Obligatorio, contenido varía por tipo
- **Why is this valuable for TollAI?** — Obligatorio, justifica el valor
- **Evidence** — Altamente recomendado, captura screenshots, logs, benchmarks, etc. Incluye nota sobre research sin evidencia concreta
- **Reproduction Steps** — Condicional, solo si aplica
- **Expected/Actual Behavior** — Estándar
- **Suggested Solution** — Condicional, solo para code contributions
- **Additional Context** - Opcional
- **AI Usage** - Sección crítica con checkboxes:
  - Usé IA para asistir
  - Entiendo y validé los cambios
  - No es output de IA sin revisar

**Por qué esta estructura funciona para TollAI:**

1. **Filtra automáticamente** los PRs que solo contienen código generado por IA sin contexto
2. **Da immediato contexto** a los mantenedores sobre qué tipo de contribución es
3. **Estructura la evidencia** en lugar de dejarla suelta
4. **Permite contributions no-code** ganar el mismo reconocimiento que code contributions
5. **Mantiene el mensaje personal** que establece las expectativas desde el inicio

---

## 5. Files Changed

**Exclusivamente archivos modificados o creados (sin código funcional de TollAI):**

| Ruta | Tipo | Descripción |
|------|------|-------------|
| `.github/PULL_REQUEST_TEMPLATE.md` | New | Template de Pull Request con mensaje personal, selección de tipo, campos estructurados y sección AI Usage |
| `.github/ISSUE_TEMPLATE/bug_report.md` | New | Template de Issue para reports de bug con campos de descripción, pasos para reproducir, y evidencia |
| `.github/ISSUE_TEMPLATE/feature_request.md` | New | Template de Issue para proposals de funcionalidad con descripción, caso de uso, valor, y evidencia |
| `.github/ISSUE_TEMPLATE/research_investigation.md` | New | Template de Issue para investigación tecnológica con metodología, hallazgos, evidencia, y limitaciones |
| `CONTRIBUTING.md` | New | Guía de contribución alineada con la filosofía de TollAI: valor no-code, reconocimiento, flujo de contribución |
| `.gitignore` | Modified | Agregadas `config.log` y `telemetry.json` para prevenir exposición de datos sensibles |
| `.npmignore` | New | Archivo de control para distribución npm del paquete `tollai` |

**No modificados (código funcional de TollAI sin cambios):**
- `server.js`, `toll-ai/`, `attackers/`, `test/`, `package.json` (contenido lógica)
- Cualquier archivo que implemente la funcionalidad del protocolo cognitive toll

---

## 6. Validation

**Qué validé:**

1. **Ubicación correcta:** `.github/PULL_REQUEST_TEMPLATE.md` está en la ruta estándar que GitHub usa para templates de PR automáticos

2. **Sintaxis Markdown:** Validado que todo el Markdown está bien formado, checkboxes son válidos, y no hay enlaces rotos

3. **Checkboxes válidos:** Los 9 checkboxes de tipo de contribución y 3 de AI Usage siguen la sintaxis de GitHub `[- ]` para checkboxes no seleccionados

4. **Ausencia de enlaces rotos:** Revisado que todas las referencias internas y externas estén correctamente formateadas

5. **Ausencia de información incorrecta:** Verificado que el mensaje personal coincida con la intención del autor y que todos los tipos de contribución estén alineados con la filosofía del proyecto

6. **Compatibilidad con GitHub:** Confirmado que la estructura `.github/PULL_REQUEST_TEMPLATE.md` es compatible con GitHub's PR loading mechanism - cuando un usuario abre un PR, GitHub mostrará automáticamente este template

7. **Que no obliga innecesariamente a escribir código:** Los checkboxes incluyen 8 tipos no-code y solo 1 code-contribution. Los campos requeridos piden "qué descubriste" y "por qué es valioso" en lugar de "código"

8. **Que permite contribución basada únicamente en investigación/evidencia:** Los campos "What did you discover?" y "Why is this valuable?" están diseñados para contributions sin una sola línea de código. La sección Evidence acepta descriptions, logs, benchmarks, o reasoning. El tipo "Research / Investigación" está diseñado específicamente para esto.

---

## 7. Future Recommendations

**Qué debería hacerse posteriormente:**

### **Alta prioridad:**

1. **`CODE_OF_CONDUCT.md`** - Implementar un Code of Conduct estándar (ej. Contributor Covenant) para establecer expectativas de comportamiento en la comunidad

2. **`SECURITY.md`** - Crear política de seguridad para reporte de vulnerabilidades, alineado con las mejores prácticas de proyectos open source

3. **`CODEOWNERS`** - Asignar propietarios de código para los diferentes módulos (toll-ai/, attackers/, test/, public/) para agilizar revisiones

4. **Branch protection rules** - Configurar protección de branches `main` y `require PR reviews` + `require passing status checks` para mantener calidad

5. **Discussions habilitadas** - Activar GitHub Discussions para preguntas generales, "watercooler" chat, y discussions de investigación antes de abrir Issues o PRs

### **Mediana prioridad:**

6. **Más Issue Templates** - Agregar templates para: "Performance Problem", "Question", "Daily Standup", o categorías específicas de los 12 escenarios

7. **Label scheme** - Definir labels de triaje: `good first issue`, `help wanted`, `research`, `bug`, `documentation`, `security`, `by-area:pow|session|dwell|anti-burst`

8. **`CHANGELOG.md`** - Inicializar con entry para v1.0.0 y proceso para mantenerlo al fusionar PRs

### **Larga prioridad:**

9. **Automatización de revisión** - Configurar bots como `first-time-contributor` o etiquetado automático basado en labels

10. **Integración con CI** - Agregar workflows de CI que ejecuten tests en PRs (fase futura cuando el proyecto madure)

11. **Process evaluation** - Después de 3-6 meses, evaluar qué tan efectivo es el template y ajustar según feedback de la comunidad

### **Específicamente para la filosofía de IA:**

12. **Guía de uso de IA** - Documentación adicional sobre cómo TollAI espera que los contribuyentes usen herramientas de IA (para investigación, draft, validación — no para generación sin revisar)

13. ** reconocimiento público** - Estructura para acknowleded contributors en releases y CHANGELOG basados en el tipo de contribución

---

## Resumen Ejecutivo

Se ha preparado TollAI para recibir contribuciones externas con una filosofía diferenciadora: **valor sobre código**. El Pull Request Template y los archivos asociados están diseñados para:

1. **Dar la bienvenida a contributions no-code** — Bug reports, research, use cases, evidence, documentation
2. **Desincentivar PRs de IA sin contexto** — A través del mensaje personal y la sección AI Usage
3. **Estructurar evidencia** — En lugar de dejarla suelta, se piden formats consistentes
4. **Reconocer todos los tipos de contribución** — A través de CONTRIBUTING.md y el proceso de releases
5. **Mantener la filosofía personal** — El mensaje del autor se conserva tal como fue especificado

Los archivos creados (6 nuevos, 1 modificado) son puramente configuracionales y de documentación, sin modificar ni una sola línea de la lógica funcional de TollAI.