# Implementation Plan: telemetry-utils

## Overview

Plano de implementação incremental e test-first para a biblioteca `@flexicorp/telemetry-utils` (TypeScript, CommonJS, Node >= 20). Cada tarefa constrói sobre as anteriores, começando pelo setup de build/testes e pelos tipos compartilhados, passando pelo Config Loader (base de validação consumida por todos os componentes), depois pelos componentes de logging, namespace, métricas e tracing, e terminando com o bootstrap do SDK e o wiring final de empacotamento.

A estratégia de testes é dupla: testes de propriedade (fast-check, mínimo 100 iterações) para a lógica pura descrita nas Correctness Properties (Properties 1–19), testes unitários para exemplos/bordas e condições de erro, e testes de integração/smoke para o SDK OpenTelemetry e os artefatos de empacotamento.

## Tasks

- [ ] 1. Configurar estrutura do projeto, build e framework de testes
  - Criar `tsconfig.json` com `target` ES2020, `module`/`moduleResolution` NodeNext, `strict`, `esModuleInterop`, `declaration`, `experimentalDecorators`, `emitDecoratorMetadata`, `rootDir` `./src`, `outDir` `./dist`, incluindo `src/**/*` e excluindo specs/node_modules/dist
  - Criar `tsup.config.mjs` com dois entry points (`src/index.ts` e `src/tracing/index.ts`), `format: ['cjs']`, `target: 'node20'`, `dts: true`, `clean: true`, `sourcemap: true`, `splitting: false`, `shims: true`, e `external` listando `winston`, `winston-loki`, `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node` e demais pacotes OTel
  - Criar `package.json` com `main` cjs, `types`, `exports` (`.` e subpath `./tracing` com `require`/`types`), `files` (`dist`, `README.md`), `engines.node >= 20.0.0`, `dependencies` (winston, winston-loki, @opentelemetry/winston-transport, @opentelemetry/sdk-node, @opentelemetry/auto-instrumentations-node, @opentelemetry/instrumentation-runtime-node, exporters OTLP http de traces/logs/metrics, @opentelemetry/sdk-metrics, @opentelemetry/sdk-logs, @opentelemetry/resources, dotenv), `peerDependencies` (`@opentelemetry/api`), e `devDependencies` (tsup, typescript, @types/node, fast-check, vitest) com scripts `build` e `test`
  - Criar `vitest.config.ts` para execução dos testes em modo single-run
  - Criar a estrutura de pastas `src/config`, `src/logging`, `src/metrics`, `src/tracing`
  - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7_

- [ ] 2. Definir tipos compartilhados
  - [ ] 2.1 Criar `src/types.ts` com os tipos públicos compartilhados
    - Definir `ExportTarget` (`'alloy' | 'otlp'`), `LogLevel`, `LogFormat`, `MetricKind` e a interface `TelemetryConfig` (incluindo `otlpEndpoints` por sinal e `exportTargets` por sinal)
    - Definir constantes de conjuntos permitidos (níveis de log, formatos, export targets) reutilizáveis pela validação
    - _Requirements: 6.1, 7.1_

- [ ] 3. Implementar o Config Loader (base de validação)
  - [ ] 3.1 Implementar resolvers de configuração enumerada em `src/config/env.ts`
    - Implementar `resolveLogLevel` (fallback tolerante para `info` + erro no console quando inválido), `resolveLogFormat` (fallback tolerante para `text` quando ausente/inválido) e `resolveExportTarget` (validação estrita, erro descritivo quando inválido)
    - Implementar `resolveOtelLogLevel` com fallback para `WARN`
    - _Requirements: 1.6, 1.7, 1.8, 1.9, 6.1, 6.4, 9.2, 9.3_

  - [ ]* 3.2 Escrever teste de propriedade para resolução de config enumerada com fallback
    - **Property 5: Resolução de configuração enumerada com fallback**
    - Tag: `Feature: telemetry-utils, Property 5: Resolução de configuração enumerada com fallback`
    - fast-check, mínimo 100 iterações, cobrindo `LOG_LEVEL`, `LOG_FORMAT` e `OTEL_LOG_LEVEL`
    - **Validates: Requirements 1.8, 1.9, 9.3**

  - [ ]* 3.3 Escrever teste de propriedade para validação estrita de Export_Target
    - **Property 14: Validação estrita de Export_Target**
    - Tag: `Feature: telemetry-utils, Property 14: Validação estrita de Export_Target`
    - fast-check, mínimo 100 iterações; valor válido aceito, inválido rejeitado com erro preservando estado não inicializado
    - **Validates: Requirements 6.1, 6.4, 7.7**

  - [ ] 3.4 Implementar `loadConfig` e a interface `TelemetryConfig` completa em `src/config/env.ts`
    - Ler todas as variáveis de ambiente (`APPLICATION_NAME`, `APP_STAGE`, `SERVICE_NAMESPACE`, `LOG_LEVEL`, `LOG_FORMAT`, `LOKI_TRANSPORT`, `LOKI_HOST`, `KUBERNETES`, `OTEL_LOG_LEVEL`, endpoints OTLP por sinal, export targets por sinal) aplicando os defaults da tabela de design
    - Aplicar defaults: `unknown-service`, `unknown-stage`, endpoints por sinal `.../v1/traces|logs|metrics`, Loki host default, export targets default `otlp`
    - Rejeitar inicialização com erro descritivo (parâmetro + valor) em config estrita inválida, preservando estado não inicializado
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 6.1, 6.4, 6.6, 6.7, 6.8_

  - [ ]* 3.5 Escrever teste de propriedade para aplicação de defaults de variáveis de ambiente
    - **Property 12: Aplicação de defaults de variáveis de ambiente**
    - Tag: `Feature: telemetry-utils, Property 12: Aplicação de defaults de variáveis de ambiente`
    - fast-check, mínimo 100 iterações; env ausente aplica default, env presente é preservada
    - **Validates: Requirements 7.1, 7.3, 7.4, 7.5**

  - [ ]* 3.6 Escrever teste de propriedade para independência dos endpoints OTLP por sinal
    - **Property 13: Independência dos endpoints OTLP por sinal**
    - Tag: `Feature: telemetry-utils, Property 13: Independência dos endpoints OTLP por sinal`
    - fast-check, mínimo 100 iterações; cada sinal reflete exclusivamente sua própria env
    - **Validates: Requirements 7.2**

  - [ ]* 3.7 Escrever teste de propriedade para resolução do host efetivo por Export_Target
    - **Property 15: Resolução do host efetivo por Export_Target**
    - Tag: `Feature: telemetry-utils, Property 15: Resolução do host efetivo por Export_Target`
    - fast-check, mínimo 100 iterações; host efetivo corresponde ao destino selecionado (`alloy`/`otlp`)
    - **Validates: Requirements 6.2, 6.3**

- [ ] 4. Checkpoint - Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implementar o WinstonLogger (níveis, cores e formatação)
  - [ ] 5.1 Implementar a classe `WinstonLogger` em `src/logging/winston-logger.ts`
    - Definir `levels` (`crit`:0 … `verbose`:7) e `colors` (cor por nível) conforme tabela de design
    - Implementar utilitários estáticos: `parsePascalCase`, `concatMessageWithDataString`, `transformArrayDataToObject`, `ucFirst`, `styled`
    - Implementar `formatContext` (injeta correlationId/keyId do Namespace) e `formatPrint(stage)` (console estilizado com prefixo `[stage-service]` e truncamento do Correlation_Id nos últimos 7 caracteres, ou integral se <= 7)
    - _Requirements: 1.1, 1.2, 1.4_

  - [ ]* 5.2 Escrever testes unitários de níveis, cores e estilização
    - Verificar prioridades numéricas dos níveis, mapeamento de cores e saída estilizada de `formatPrint` (exemplos concretos)
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

  - [ ]* 5.3 Escrever teste de propriedade para truncamento do Correlation_Id
    - **Property 3: Truncamento do Correlation_Id**
    - Tag: `Feature: telemetry-utils, Property 3: Truncamento do Correlation_Id`
    - fast-check, mínimo 100 iterações; últimos 7 chars quando > 7, integral quando <= 7
    - **Validates: Requirements 1.4**

  - [ ]* 5.4 Escrever teste de propriedade para filtragem por prioridade de nível
    - **Property 2: Filtragem por prioridade de nível**
    - Tag: `Feature: telemetry-utils, Property 2: Filtragem por prioridade de nível`
    - fast-check, mínimo 100 iterações; emite sse prioridade do registro <= prioridade configurada
    - **Validates: Requirements 1.1, 1.6, 1.7**

- [ ] 6. Implementar o Namespace (AsyncLocalStorage)
  - [ ] 6.1 Implementar a classe `Namespace` em `src/logging/namespace.ts`
    - Implementar `run` (escopo isolado via AsyncLocalStorage), `isActived`, `setRequestId`/`getRequestId`, `setkeyId`/`getkeyId`
    - Fora de escopo: `set*` é no-op sem interromper execução; `get*` retorna indefinido/null
    - Exportar instância default
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 2.7_

  - [ ]* 6.2 Escrever teste de propriedade para round-trip de armazenamento dentro de escopo
    - **Property 6: Round-trip de armazenamento do Namespace dentro de escopo**
    - Tag: `Feature: telemetry-utils, Property 6: Round-trip de armazenamento do Namespace dentro de escopo`
    - fast-check, mínimo 100 iterações
    - **Validates: Requirements 2.2, 2.3**

  - [ ]* 6.3 Escrever teste de propriedade para isolamento entre escopos concorrentes
    - **Property 7: Isolamento entre escopos concorrentes do Namespace**
    - Tag: `Feature: telemetry-utils, Property 7: Isolamento entre escopos concorrentes do Namespace`
    - fast-check, mínimo 100 iterações
    - **Validates: Requirements 2.1**

  - [ ]* 6.4 Escrever teste de propriedade para operações fora de escopo
    - **Property 8: Operações do Namespace fora de escopo**
    - Tag: `Feature: telemetry-utils, Property 8: Operações do Namespace fora de escopo`
    - fast-check, mínimo 100 iterações; `set*` no-op, `get*` indefinido
    - **Validates: Requirements 2.6, 2.7**

- [ ] 7. Checkpoint - Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implementar o LoggerService
  - [ ] 8.1 Implementar a classe `LoggerService extends WinstonLogger` em `src/logging/logger-service.ts`
    - Construtor com `context`, `logLevel` (default via Config Loader), `stage`, `service`; `defaultMeta: { service }`
    - Formato combinado: `otelFormat` (injeta `traceId`/`spanId` do span ativo quando houver) + `formatContext` (correlationId/keyId do Namespace) + `timestamp` + json; incluir sempre `timestamp`/`level`/`service`/`message`
    - Selecionar console estilizado quando `LOG_FORMAT ∈ {text, message}` ou console JSON caso contrário
    - Adicionar transporte `OpenTelemetryTransportV3` no nível corrente
    - Adicionar `LokiTransport` apenas quando `LOKI_TRANSPORT === 'true'`, usando `LOKI_HOST` ou host default
    - Registrar listener `on('error')` que loga no console de erro sem derrubar o processo
    - _Requirements: 1.3, 1.5, 1.10, 2.4, 2.5, 3.1, 3.2, 6.6, 6.7, 6.8_

  - [ ] 8.2 Implementar o método `withTrace` no LoggerService
    - Criar span ativo nomeado, executar fn em seu contexto; em sucesso encerrar span e retornar valor; em exceção `recordException` + status erro + encerrar span + repropagar
    - _Requirements: 3.3, 3.4_

  - [ ]* 8.3 Escrever teste de propriedade para campos obrigatórios do registro
    - **Property 1: Registro de log sempre contém campos obrigatórios**
    - Tag: `Feature: telemetry-utils, Property 1: Registro de log sempre contém campos obrigatórios`
    - fast-check, mínimo 100 iterações; `timestamp`/`level`/`service`/`message` sempre presentes
    - **Validates: Requirements 1.3**

  - [ ]* 8.4 Escrever teste de propriedade para campos de correlação condicionais
    - **Property 4: Campos de correlação condicionados ao escopo de Namespace**
    - Tag: `Feature: telemetry-utils, Property 4: Campos de correlação condicionados ao escopo de Namespace`
    - fast-check, mínimo 100 iterações; correlationId/keyId presentes sse escopo ativo
    - **Validates: Requirements 2.4, 2.5**

  - [ ]* 8.5 Escrever teste de propriedade para campos de tracing condicionais
    - **Property 9: Campos de tracing condicionados ao Span ativo**
    - Tag: `Feature: telemetry-utils, Property 9: Campos de tracing condicionados ao Span ativo`
    - fast-check, mínimo 100 iterações; traceId/spanId presentes sse span ativo
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 8.6 Escrever teste de propriedade para semântica de sucesso/erro de `withTrace`
    - **Property 10: Semântica de sucesso e erro de `withTrace`**
    - Tag: `Feature: telemetry-utils, Property 10: Semântica de sucesso e erro de withTrace`
    - fast-check, mínimo 100 iterações; sobre funções geradas que resolvem ou lançam
    - **Validates: Requirements 3.3, 3.4**

  - [ ]* 8.7 Escrever teste de propriedade para presença condicional do transporte Loki
    - **Property 16: Presença condicional do transporte Loki**
    - Tag: `Feature: telemetry-utils, Property 16: Presença condicional do transporte Loki`
    - fast-check, mínimo 100 iterações; transporte presente sse `LOKI_TRANSPORT==='true'`, host default quando ausente
    - **Validates: Requirements 6.6, 6.7, 6.8**

  - [ ]* 8.8 Escrever teste unitário de resiliência de transporte
    - Mock de transporte que lança; verificar que o listener `on('error')` loga no console de erro e o processo continua emitindo os demais registros
    - _Requirements: 1.10_

- [ ] 9. Checkpoint - Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implementar o MetricsProvider
  - [ ] 10.1 Implementar a classe `MetricsProvider` em `src/metrics/metrics-provider.ts`
    - Construtor recebendo `TelemetryConfig`
    - Implementar `counter`, `histogram`, `gauge` retornando `MetricHandle` com `record(value, attributes)`
    - Implementar `register(kind, name, options)` que rejeita tipo inválido com erro descritivo identificando o tipo
    - _Requirements: 4.1, 4.6_

  - [ ]* 10.2 Escrever teste de propriedade para validação do tipo de métrica
    - **Property 11: Validação do tipo de métrica**
    - Tag: `Feature: telemetry-utils, Property 11: Validação do tipo de métrica`
    - fast-check, mínimo 100 iterações; tipo válido cria handle, inválido rejeita com erro
    - **Validates: Requirements 4.1, 4.6**

- [ ] 11. Implementar o TracerProvider
  - [ ] 11.1 Implementar a classe `TracerProvider` em `src/tracing/tracer-provider.ts`
    - Construtor recebendo `TelemetryConfig`
    - Implementar `startSpan(name, options)` com validação de comprimento do nome (1..255), criando span raiz na ausência de span ativo
    - Implementar `startActiveSpan(name, fn)` vinculando ao Trace_Context do pai quando houver
    - _Requirements: 5.1, 5.4_

  - [ ]* 11.2 Escrever teste de propriedade para validação do comprimento do nome do Span
    - **Property 17: Validação do comprimento do nome do Span**
    - Tag: `Feature: telemetry-utils, Property 17: Validação do comprimento do nome do Span`
    - fast-check, mínimo 100 iterações; aceita 1..255, rejeita 0 e > 255
    - **Validates: Requirements 5.1**

  - [ ]* 11.3 Escrever teste de propriedade para vínculo de contexto pai/filho de Spans
    - **Property 18: Vínculo de contexto pai/filho de Spans**
    - Tag: `Feature: telemetry-utils, Property 18: Vínculo de contexto pai/filho de Spans`
    - fast-check, mínimo 100 iterações; filho compartilha traceId do pai, raiz quando sem ativo
    - **Validates: Requirements 5.4**

- [ ] 12. Checkpoint - Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Implementar o Telemetry_Bootstrap
  - [ ] 13.1 Implementar a função pura de decisão de ativação do SDK
    - Em `src/tracing/index.ts` (ou helper dedicado), implementar função que decide iniciar o Node_SDK sse `KUBERNETES === 'true'`
    - _Requirements: 9.4, 9.5_

  - [ ]* 13.2 Escrever teste de propriedade para decisão de ativação do SDK por `KUBERNETES`
    - **Property 19: Decisão de ativação do SDK por `KUBERNETES`**
    - Tag: `Feature: telemetry-utils, Property 19: Decisão de ativação do SDK por KUBERNETES`
    - fast-check, mínimo 100 iterações; verdadeiro sse valor exatamente `true`
    - **Validates: Requirements 9.4, 9.5**

  - [ ] 13.3 Implementar o módulo de bootstrap por efeito colateral em `src/tracing/index.ts`
    - Carregar `dotenv.config()` como primeira instrução, antes de configurar o SDK
    - Configurar `diag.setLogger` a partir de `OTEL_LOG_LEVEL` (fallback `WARN`)
    - Quando `KUBERNETES === 'true'`: instanciar `NodeSDK` com `OTLPTraceExporter`/`OTLPLogExporter`/`OTLPMetricExporter` (endpoints por sinal), `resourceFromAttributes` (`service.name`, `service_namespace`, `deployment.environment`), `BatchLogRecordProcessor`, auto-instrumentações (`getNodeAutoInstrumentations` com winston habilitado e http ignorando `/metrics`), `RuntimeNodeInstrumentation`, `PeriodicExportingMetricReader` (60000ms); iniciar com `sdk.start()`
    - Resolver host/endpoint efetivo de cada exportador conforme `Export_Target` (`alloy`/`otlp`)
    - Registrar handlers `SIGTERM`/`SIGINT` para shutdown gracioso do SDK
    - Quando `KUBERNETES !== 'true'`: registrar no console que a telemetria foi ignorada em modo local
    - Exportar `sdk` default (NodeSDK | null)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 6.2, 6.3_

  - [ ]* 13.4 Escrever testes de integração do bootstrap e do SDK
    - Verificar agregação/export de métricas e atributos de recurso, envio/atributos de spans, wiring de config no SDK, auto-instrumentações (winston habilitado, ignore de `/metrics`) e ordem de import/start antes de módulos instrumentados, com 1–3 exemplos representativos
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 5.2, 5.3, 5.5, 6.5, 7.6, 9.6, 9.7, 9.9, 9.11_

- [ ] 14. Implementar o ponto de entrada raiz
  - [ ] 14.1 Implementar `src/index.ts` com re-exports públicos nomeados
    - Re-exportar `LoggerService`, `Namespace`, `MetricsProvider`, `TracerProvider` e tipos públicos
    - NÃO importar o bootstrap (a importação da raiz não deve iniciar o SDK)
    - _Requirements: 8.5_

- [ ] 15. Wiring final, build e validação de empacotamento
  - [ ] 15.1 Executar o build com tsup e validar os artefatos gerados
    - Rodar `npm run build` e verificar geração de `dist/index.js`, `dist/tracing/index.js` e os `.d.ts` por entry point
    - _Requirements: 8.1, 8.6_

  - [ ]* 15.2 Escrever smoke tests de empacotamento
    - Verificar que o artefato CJS raiz é carregável via `require` e expõe os exports nomeados; que o subpath `./tracing` é importável; que os `.d.ts` existem por ponto de entrada; que `@opentelemetry/api` (peerDependency) está fora do bundle; e que `engines.node >= 20.0.0`
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7_

- [ ] 16. Checkpoint final - Garantir que todos os testes passam
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP mais rápido, mas são fortemente recomendadas dada a presença de propriedades formais no design.
- Cada tarefa referencia requisitos específicos para rastreabilidade; tarefas de PBT referenciam explicitamente a propriedade de design e usam a tag `Feature: telemetry-utils, Property {n}: ...`.
- Testes de propriedade usam fast-check com no mínimo 100 iterações e mockam dependências de I/O (OTel SDK, transportes) para isolar a lógica pura.
- Testes de integração/smoke cobrem o comportamento do SDK OpenTelemetry e os artefatos de empacotamento (R4.2–R4.5, R5.2/R5.3/R5.5, R6.5, R7.6, R8.x, R9 wiring).
- Checkpoints garantem validação incremental ao longo do plano.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3"] },
    { "id": 4, "tasks": ["3.4"] },
    { "id": 5, "tasks": ["3.5", "3.6", "3.7", "5.1", "6.1", "10.1", "11.1", "13.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "5.4", "6.2", "6.3", "6.4", "10.2", "11.2", "11.3", "13.2"] },
    { "id": 7, "tasks": ["8.1"] },
    { "id": 8, "tasks": ["8.2"] },
    { "id": 9, "tasks": ["8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "13.3"] },
    { "id": 10, "tasks": ["13.4", "14.1"] },
    { "id": 11, "tasks": ["15.1"] },
    { "id": 12, "tasks": ["15.2"] }
  ]
}
```
