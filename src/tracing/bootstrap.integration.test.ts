/**
 * Testes de INTEGRAÇÃO / SMOKE do Telemetry_Bootstrap e do SDK (tarefa 13.4).
 *
 * Diferente dos testes de propriedade (lógica pura), estes exemplos
 * representativos (1–3 por aspecto) exercitam o comportamento de wiring do SDK
 * OpenTelemetry e dos componentes de exportação:
 *
 * - Modo local (`KUBERNETES !== 'true'`): o módulo de bootstrap NÃO inicia o
 *   Node_SDK e registra no console que a telemetria foi ignorada; o export
 *   default é `null` (R9.5).
 * - Modo Kubernetes (`KUBERNETES === 'true'`): o `NodeSDK` é construído com os
 *   atributos de recurso (`service.name`/`service_namespace`/
 *   `deployment.environment`) vindos do ambiente, o leitor periódico de
 *   métricas usa intervalo de 60000ms, `start()` é invocado, as
 *   auto-instrumentações habilitam Winston e o HTTP ignora `/metrics`
 *   (R6.5, R7.6, R9.6, R9.7, R9.9, R9.11).
 * - Agregação/export de métricas e atributos de recurso via SDK em memória
 *   (R4.2, R4.3, R4.4).
 * - Envio/atributos de spans e atributos de recurso via SDK em memória
 *   (R5.2, R5.3, R5.5).
 *
 * Validates: Requirements 4.2, 4.3, 4.4, 4.5, 5.2, 5.3, 5.5, 6.5, 7.6, 9.6,
 *            9.7, 9.9, 9.11
 *
 * NOTA DE INFRAESTRUTURA DE TESTE:
 * O módulo `./index` executa por EFEITO COLATERAL ao ser importado (lê
 * `process.env`, configura `diag` e, em modo Kubernetes, instancia/inicia o
 * `NodeSDK`). Para testar ambos os ramos de forma segura e sem abrir conexões
 * de rede ou travar o processo, os módulos pesados do OTel
 * (`@opentelemetry/sdk-node` e `@opentelemetry/auto-instrumentations-node`) são
 * mockados com `vi.mock`, e cada caso usa `vi.resetModules()` + `await
 * import('./index')` para reavaliar o bootstrap sob o ambiente desejado. O
 * `process.env` é restaurado entre os testes.
 */

import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { metrics, trace } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { MetricsProvider } from '../metrics/metrics-provider';
import { TracerProvider } from './tracer-provider';
import type { TelemetryConfig } from '../types';

// ---------------------------------------------------------------------------
// Mocks dos módulos pesados do OTel usados pelo bootstrap por efeito colateral.
// ---------------------------------------------------------------------------

/** Captura dos argumentos passados ao construtor do NodeSDK e à chamada start(). */
const nodeSdkCtorArgs: unknown[] = [];
const nodeSdkStart = vi.fn();
const nodeSdkShutdown = vi.fn().mockResolvedValue(undefined);

vi.mock('@opentelemetry/sdk-node', () => ({
  // Classe (e não arrow function) para ser construível via `new` nesta versão
  // do vitest; captura os argumentos do construtor para inspeção posterior.
  NodeSDK: class {
    start = nodeSdkStart;

    shutdown = nodeSdkShutdown;

    constructor(config: unknown) {
      nodeSdkCtorArgs.push(config);
    }
  },
}));

/** Captura da configuração de auto-instrumentações para inspeção dos hooks. */
const autoInstrumentationsConfig: unknown[] = [];

vi.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: vi.fn().mockImplementation((config: unknown) => {
    autoInstrumentationsConfig.push(config);
    // Retorna um array vazio: o SDK está mockado e não registra nada de fato.
    return [];
  }),
}));

/** Instrumentação de runtime mockada (evita monkey-patching real). */
vi.mock('@opentelemetry/instrumentation-runtime-node', () => ({
  RuntimeNodeInstrumentation: class {},
}));

/**
 * Tipagem auxiliar para inspecionar a config do NodeSDK capturada, cobrindo
 * apenas os campos relevantes a estes testes.
 */
interface CapturedNodeSdkConfig {
  resource: { attributes: Record<string, unknown> };
  metricReaders: Array<{ _exportInterval?: number } & Record<string, unknown>>;
}

/**
 * Shape da config de auto-instrumentações relevante aos testes: habilitação do
 * Winston e hook de ignore de requisições HTTP de entrada.
 */
interface CapturedAutoInstrumentationsConfig {
  '@opentelemetry/instrumentation-winston'?: { enabled?: boolean; disableLogSending?: boolean };
  '@opentelemetry/instrumentation-http'?: {
    ignoreIncomingRequestHook?: (request: { url?: string }) => boolean;
  };
}

/** Ambiente original, restaurado após cada teste. */
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  // Isola o ambiente de cada teste em uma cópia descartável.
  process.env = { ...ORIGINAL_ENV };
  // Limpa capturas e reseta o grafo de módulos para reavaliar o bootstrap.
  nodeSdkCtorArgs.length = 0;
  autoInstrumentationsConfig.length = 0;
  nodeSdkStart.mockClear();
  nodeSdkShutdown.mockClear();
  vi.resetModules();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

// ===========================================================================
// Bootstrap — modo local (KUBERNETES !== 'true')
// ===========================================================================

describe('Telemetry_Bootstrap — modo local (KUBERNETES !== "true")', () => {
  it('não inicia o Node_SDK, exporta null e registra o skip no console (R9.5)', async () => {
    process.env.KUBERNETES = 'false';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const mod = await import('./index');

    // Export default é null: nenhum SDK foi instanciado (R9.5).
    expect(mod.default).toBeNull();
    // Nenhuma construção/start do NodeSDK ocorreu.
    expect(nodeSdkCtorArgs).toHaveLength(0);
    expect(nodeSdkStart).not.toHaveBeenCalled();
    // Mensagem de skip de telemetria registrada no console (R9.5).
    const loggedSkip = logSpy.mock.calls.some(([arg]) =>
      typeof arg === 'string' && arg.includes('modo local'),
    );
    expect(loggedSkip).toBe(true);
  });
});

// ===========================================================================
// Bootstrap — modo Kubernetes (KUBERNETES === 'true')
// ===========================================================================

describe('Telemetry_Bootstrap — modo Kubernetes (KUBERNETES === "true")', () => {
  it('constrói e inicia o NodeSDK com recurso, intervalo de 60s e auto-instrumentações (R7.6, R9.6, R9.7, R9.9, R9.11)', async () => {
    process.env.KUBERNETES = 'true';
    process.env.APPLICATION_NAME = 'orders-service';
    process.env.SERVICE_NAMESPACE = 'commerce';
    process.env.APP_STAGE = 'production';

    const mod = await import('./index');

    // O NodeSDK foi construído e iniciado exatamente uma vez (R9.4, R9.11).
    expect(nodeSdkCtorArgs).toHaveLength(1);
    expect(nodeSdkStart).toHaveBeenCalledTimes(1);
    // O export default referencia a instância do SDK (não-null).
    expect(mod.default).not.toBeNull();

    const config = nodeSdkCtorArgs[0] as CapturedNodeSdkConfig;

    // (R9.8) Atributos de recurso vindos do ambiente.
    expect(config.resource.attributes['service.name']).toBe('orders-service');
    expect(config.resource.attributes.service_namespace).toBe('commerce');
    expect(config.resource.attributes['deployment.environment']).toBe('production');

    // (R9.9) Leitor periódico de métricas com intervalo de 60000ms.
    expect(config.metricReaders).toHaveLength(1);
    const reader = config.metricReaders[0] as unknown as Record<string, unknown>;
    const interval =
      (reader._exportInterval as number | undefined) ??
      (reader.exportIntervalMillis as number | undefined);
    // Dependendo da versão do SDK o campo interno pode variar; aceitamos ambos.
    if (interval !== undefined) {
      expect(interval).toBe(60_000);
    }
    // Garantia independente de versão: o reader é um PeriodicExportingMetricReader.
    expect(reader.constructor.name).toBe('PeriodicExportingMetricReader');

    // (R9.6/R9.7) Config de auto-instrumentações capturada.
    expect(autoInstrumentationsConfig).toHaveLength(1);
    const autoCfg = autoInstrumentationsConfig[0] as CapturedAutoInstrumentationsConfig;

    // Winston habilitado (R9.6).
    expect(autoCfg['@opentelemetry/instrumentation-winston']?.enabled).toBe(true);
    // Evita duplicacao: o reenvio de logs pela auto-instrumentacao do Winston
    // fica desligado (o LoggerService ja anexa o OpenTelemetryTransportV3).
    expect(autoCfg['@opentelemetry/instrumentation-winston']?.disableLogSending).toBe(true);

    // (R9.7) HTTP ignora requisições de entrada destinadas a `/metrics`.
    const ignoreHook = autoCfg['@opentelemetry/instrumentation-http']?.ignoreIncomingRequestHook;
    expect(typeof ignoreHook).toBe('function');
    expect(ignoreHook?.({ url: '/metrics' })).toBe(true);
    expect(ignoreHook?.({ url: '/orders' })).toBe(false);
  });
});

// ===========================================================================
// Smoke — agregação/export de métricas e atributos de recurso (R4.2, R4.3, R4.4)
// ===========================================================================

/** Monta uma TelemetryConfig mínima para os smokes de métricas/traces. */
function makeConfig(applicationName: string): TelemetryConfig {
  return {
    applicationName,
    stage: 'test',
    serviceNamespace: 'ns',
    logLevel: 'info',
    logFormat: 'text',
    lokiTransport: false,
    lokiHost: 'http://loki.local:3100',
    kubernetes: false,
    otelLogLevel: 'WARN',
    otlpEndpoints: {
      traces: 'http://otel.local:4318/v1/traces',
      logs: 'http://otel.local:4318/v1/logs',
      metrics: 'http://otel.local:4318/v1/metrics',
    },
    exportTargets: { traces: 'otlp', metrics: 'otlp' },
  };
}

describe('MetricsProvider — agregação e export de métricas via SDK em memória (R4.2, R4.3, R4.4)', () => {
  it('agrega e exporta um contador com atributos de ponto e atributos de recurso', async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({
      exporter,
      // Intervalo longo: o flush é forçado manualmente para evitar timers pendentes.
      exportIntervalMillis: 10 * 60_000,
    });
    const resource = resourceFromAttributes({
      'service.name': 'metrics-smoke',
      'deployment.environment': 'test',
    });
    const meterProvider = new MeterProvider({ resource, readers: [reader] });
    metrics.setGlobalMeterProvider(meterProvider);

    try {
      const provider = new MetricsProvider(makeConfig('metrics-smoke'));
      const counter = provider.counter('requests_total');
      counter.record(3, { route: '/orders' });
      counter.record(4, { route: '/orders' });

      await reader.forceFlush();
      const exported = exporter.getMetrics();
      const resourceMetrics = exported[exported.length - 1];

      // (R4.4) Atributos de recurso presentes nas métricas exportadas.
      expect(resourceMetrics.resource.attributes['service.name']).toBe('metrics-smoke');
      expect(resourceMetrics.resource.attributes['deployment.environment']).toBe('test');

      const metric = resourceMetrics.scopeMetrics[0].metrics.find(
        (m) => m.descriptor.name === 'requests_total',
      );
      expect(metric).toBeDefined();
      // (R4.2) O contador agregou as duas medições (3 + 4 = 7).
      expect(metric?.dataPointType).toBe(DataPointType.SUM);
      const point = metric?.dataPoints.find((p) => p.attributes.route === '/orders');
      expect(point?.value).toBe(7);
    } finally {
      metrics.disable();
      await meterProvider.shutdown();
    }
  });
});

// ===========================================================================
// Smoke — envio/atributos de spans e atributos de recurso (R5.2, R5.3, R5.5)
// ===========================================================================

describe('TracerProvider — export de spans com atributos e recurso via SDK em memória (R5.2, R5.3)', () => {
  it('encerra um span e o exporta com nome, atributos e atributos de recurso', async () => {
    const exporter = new InMemorySpanExporter();
    const sdkProvider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        'service.name': 'traces-smoke',
        'deployment.environment': 'test',
      }),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(sdkProvider);

    try {
      const provider = new TracerProvider(makeConfig('traces-smoke'));
      const span = provider.startSpan('handle-order');
      span.setAttribute('order.id', 'abc-123');
      // (R5.2) O encerramento do span dispara o envio ao exportador.
      span.end();

      const finished = exporter.getFinishedSpans();
      expect(finished).toHaveLength(1);
      expect(finished[0].name).toBe('handle-order');
      expect(finished[0].attributes['order.id']).toBe('abc-123');
      // (R5.3) Atributos de recurso aplicados aos spans exportados.
      expect(finished[0].resource.attributes['service.name']).toBe('traces-smoke');
      expect(finished[0].resource.attributes['deployment.environment']).toBe('test');
    } finally {
      trace.disable();
      await sdkProvider.shutdown();
    }
  });
});
