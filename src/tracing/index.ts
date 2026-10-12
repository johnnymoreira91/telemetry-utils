/**
 * Telemetry_Bootstrap (`src/tracing/index.ts`) — R9.
 *
 * Módulo de inicialização do SDK OpenTelemetry Node, importável POR EFEITO
 * COLATERAL através do subcaminho dedicado `@flexicorp/telemetry-utils/tracing`
 * (R8.7). Deve ser importado como a PRIMEIRA instrução do ponto de entrada do
 * serviço, para que as auto-instrumentações sejam registradas via
 * monkey-patching ANTES de qualquer módulo instrumentado (ex.: `http`,
 * `winston`) ser carregado (R9.11).
 *
 * Ordem de execução (crítica):
 * 1. `dotenv.config()` como primeira instrução, antes de configurar o SDK (R9.1).
 * 2. `diag.setLogger(...)` a partir de `OTEL_LOG_LEVEL`, com fallback `WARN` (R9.2, R9.3).
 * 3. Quando `KUBERNETES === 'true'` (R9.4): instancia e inicia o `NodeSDK` com
 *    exportadores OTLP HTTP independentes por sinal, recurso, processadores e
 *    auto-instrumentações; caso contrário, apenas registra no console que a
 *    telemetria foi ignorada em modo local (R9.5).
 * 4. Registra handlers `SIGTERM`/`SIGINT` para encerramento gracioso do SDK (R9.10).
 *
 * O `Export_Target` (`alloy` | `otlp`) é resolvido pelo Config Loader para
 * selecionar o Host/endpoint de cada exportador OTLP HTTP de traces e métricas
 * (R6.2, R6.3): como ambos os destinos consomem OTLP HTTP, a seleção apenas
 * direciona a URL do exportador.
 */

// 1. Carregamento das variáveis de ambiente ANTES de qualquer outra configuração (R9.1).
import * as dotenv from 'dotenv';

dotenv.config();

import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { loadConfig, resolveEffectiveEndpoint, resolveOtelLogLevel } from '../config/env';
import { shouldStartSdk } from './should-start-sdk';

/** Intervalo de exportação periódica de métricas, em milissegundos (R9.9). */
const METRIC_EXPORT_INTERVAL_MILLIS = 60_000;

/** Rota HTTP de entrada cuja instrumentação deve ser ignorada (R9.7). */
const METRICS_ROUTE = '/metrics';

// 2. Nível de diagnóstico do OpenTelemetry a partir de OTEL_LOG_LEVEL, com
//    fallback tolerante para WARN em ausência/invalidez (R9.2, R9.3).
const otelLogLevel = resolveOtelLogLevel(process.env.OTEL_LOG_LEVEL);
diag.setLogger(
  new DiagConsoleLogger(),
  DiagLogLevel[otelLogLevel as keyof typeof DiagLogLevel],
);

// Configuração resolvida (defaults aplicados e validações estritas executadas — R7).
const config = loadConfig();

/**
 * Instância do Node_SDK quando o bootstrap é executado em ambiente Kubernetes
 * (`KUBERNETES === 'true'`); `null` em modo local. Exportada por padrão apenas
 * para fins de inspeção/teste — a importação ocorre primariamente por efeito
 * colateral.
 */
let sdk: NodeSDK | null = null;

if (shouldStartSdk(process.env.KUBERNETES)) {
  // 3. Exportadores OTLP HTTP independentes por sinal. Para traces e métricas, o
  //    Host/endpoint efetivo é selecionado conforme o Export_Target do sinal
  //    (R6.2, R6.3); logs utiliza diretamente o endpoint OTLP de logs (R9.4).
  const traceExporter = new OTLPTraceExporter({
    url: resolveEffectiveEndpoint(config, 'traces'),
  });

  const logExporter = new OTLPLogExporter({
    url: config.otlpEndpoints.logs,
  });

  const metricExporter = new OTLPMetricExporter({
    url: resolveEffectiveEndpoint(config, 'metrics'),
  });

  // Atributos de recurso a partir das variáveis de ambiente (R9.8).
  const resource = resourceFromAttributes({
    'service.name': config.applicationName,
    service_namespace: config.serviceNamespace,
    'deployment.environment': config.stage,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    // Processador em lote para logs envolvendo o exportador OTLP de logs (R9.4).
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: logExporter })],
    // Leitor periódico de métricas com intervalo de 60 segundos (R9.9).
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: METRIC_EXPORT_INTERVAL_MILLIS,
      }),
    ],
    instrumentations: [
      // Auto-instrumentações de Node.js: Winston habilitado (R9.6) e HTTP
      // ignorando requisições de entrada destinadas a `/metrics` (R9.7).
      getNodeAutoInstrumentations({
        // Winston instrumentado para INJETAR o trace context (traceId/spanId)
        // nos registros (R9.6). O reenvio automatico de logs ao Collector e
        // DESABILITADO (`disableLogSending: true`) porque o LoggerService ja
        // anexa o OpenTelemetryTransportV3 explicitamente; sem isso, cada log
        // seria exportado em DOBRO.
        '@opentelemetry/instrumentation-winston': {
          enabled: true,
          disableLogSending: true,
        },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request) => request.url === METRICS_ROUTE,
        },
      }),
      // Instrumentação de runtime do Node.js (R9.6).
      new RuntimeNodeInstrumentation(),
    ],
  });

  sdk.start();

  // 4. Encerramento gracioso do Node_SDK em SIGTERM/SIGINT antes de terminar o
  //    processo (R9.10).
  const shutdown = (): void => {
    sdk
      ?.shutdown()
      .then(() => diag.debug('[telemetry-utils] Node_SDK encerrado com sucesso.'))
      .catch((error: unknown) =>
        diag.error('[telemetry-utils] Falha ao encerrar o Node_SDK.', error as Error),
      )
      .finally(() => process.exit(0));
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} else {
  // 5. Modo local: o SDK não é iniciado e a decisão é registrada no console (R9.5).
  console.log(
    '[telemetry-utils] Telemetria ignorada em modo local ' +
      '(KUBERNETES !== "true"): o Node_SDK nao foi iniciado.',
  );
}

export default sdk;
