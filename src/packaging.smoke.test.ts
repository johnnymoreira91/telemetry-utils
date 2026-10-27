/**
 * Smoke tests de empacotamento (Task 15.2) — valida os artefatos compilados em
 * `dist/` conforme Requirement 8.
 *
 * Diferente dos demais testes (que exercitam `src/`), estes testes carregam os
 * artefatos CJS gerados pelo build (`dist/index.js` e `dist/tracing/index.js`),
 * verificando o contrato de distribuição do pacote:
 *
 * - o artefato CJS raiz é carregável via `require` e expõe os exports nomeados
 *   `LoggerService`, `Namespace`, `MetricsProvider`, `TracerProvider` (R8.1, R8.5);
 * - o subcaminho `./tracing` (`dist/tracing/index.js`) é importável via `require`
 *   sem derrubar o processo, tomando o ramo de modo local (R8.7, R9.5);
 * - os arquivos `.d.ts` existem por ponto de entrada (R8.6);
 * - `@opentelemetry/api` é peerDependency e NÃO está entre as `dependencies`,
 *   além de não ser inlinado no bundle (R8.2);
 * - `engines.node` declara versão mínima `>=20.0.0` (R8.3).
 *
 * Observação importante: requerer o bootstrap do subcaminho executa efeitos
 * colaterais. Por isso o ambiente é ajustado para `KUBERNETES='false'` ANTES do
 * `require`, garantindo o ramo de modo local (o Node_SDK não é iniciado e nenhum
 * handler de SIGTERM/SIGINT é registrado).
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Raiz do projeto (este arquivo vive em `src/`).
const PROJECT_ROOT = resolve(__dirname, '..');
const DIST_DIR = resolve(PROJECT_ROOT, 'dist');

const DIST_INDEX_JS = resolve(DIST_DIR, 'index.js');
const DIST_INDEX_DTS = resolve(DIST_DIR, 'index.d.ts');
const DIST_TRACING_JS = resolve(DIST_DIR, 'tracing', 'index.js');
const DIST_TRACING_DTS = resolve(DIST_DIR, 'tracing', 'index.d.ts');

// `require` real resolvido a partir deste módulo, usado para carregar os
// artefatos CJS pelo caminho absoluto do dist.
const nodeRequire = createRequire(__filename);

describe('Empacotamento: artefato CJS raiz (dist/index.js)', () => {
  it('é carregável via require e expõe os exports nomeados (R8.1, R8.5)', () => {
    const rootArtifact = nodeRequire(DIST_INDEX_JS);

    expect(typeof rootArtifact.LoggerService).toBe('function');
    expect(typeof rootArtifact.Namespace).toBe('function');
    expect(typeof rootArtifact.MetricsProvider).toBe('function');
    expect(typeof rootArtifact.TracerProvider).toBe('function');
    expect(typeof rootArtifact.TraceClass).toBe('function');
    expect(typeof rootArtifact.Trace).toBe('function');
    expect(typeof rootArtifact.log).toBe('function');
  });
});

describe('Empacotamento: subcaminho ./tracing (dist/tracing/index.js)', () => {
  it('existe no disco (R8.7)', () => {
    expect(existsSync(DIST_TRACING_JS)).toBe(true);
  });

  it('é importável via require em modo local sem derrubar o processo e seu default é null (R8.7, R9.5)', () => {
    // Garante o ramo de modo local ANTES de carregar o bootstrap: assim o
    // Node_SDK não é iniciado e nenhum handler de sinal é registrado.
    process.env.KUBERNETES = 'false';

    const tracingArtifact = nodeRequire(DIST_TRACING_JS);

    // Em modo local, o export default do bootstrap é o `sdk`, que vale null.
    expect(tracingArtifact.default).toBeNull();
  });
});

describe('Empacotamento: declarações de tipos por ponto de entrada', () => {
  it('dist/index.d.ts e dist/tracing/index.d.ts existem no disco (R8.6)', () => {
    expect(existsSync(DIST_INDEX_DTS)).toBe(true);
    expect(existsSync(DIST_TRACING_DTS)).toBe(true);
  });
});

describe('Empacotamento: peerDependency @opentelemetry/api fora do bundle (R8.2)', () => {
  const pkg = JSON.parse(
    readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf-8'),
  ) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  it('está declarada em peerDependencies e NÃO em dependencies', () => {
    expect(pkg.peerDependencies?.['@opentelemetry/api']).toBeDefined();
    expect(pkg.dependencies?.['@opentelemetry/api']).toBeUndefined();
  });

  it('não é inlinada nos bundles; é referenciada como require externo', () => {
    const rootBundle = readFileSync(DIST_INDEX_JS, 'utf-8');
    const tracingBundle = readFileSync(DIST_TRACING_JS, 'utf-8');

    // O pacote deve ser mantido externo: um require(...) do nome do pacote
    // indica que o módulo não foi inlinado no bundle.
    expect(rootBundle).toMatch(/require\(["']@opentelemetry\/api["']\)/);
    expect(tracingBundle).toMatch(/require\(["']@opentelemetry\/api["']\)/);
  });
});

describe('Empacotamento: requisito de versão mínima de Node (R8.3)', () => {
  it('engines.node declara >=20.0.0', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf-8'),
    ) as { engines?: { node?: string } };

    expect(pkg.engines?.node).toBe('>=20.0.0');
  });
});
