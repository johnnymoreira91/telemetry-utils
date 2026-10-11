/**
 * Metrics_Provider (R4, R6).
 *
 * Encapsula a API de métricas do OpenTelemetry (`@opentelemetry/api` `metrics`),
 * expondo uma interface uniforme para registrar métricas do tipo contador,
 * histograma e medidor (gauge). Cada método de registro retorna um
 * {@link MetricHandle} com `record(value, attributes)`, independentemente do
 * tipo subjacente do instrumento OpenTelemetry:
 *
 * - `counter`   -> `Counter.add(value, attributes)`
 * - `histogram` -> `Histogram.record(value, attributes)`
 * - `gauge`     -> `Gauge.record(value, attributes)`
 *
 * Os exportadores e o `PeriodicExportingMetricReader` (intervalo de 60s) são
 * configurados pelo bootstrap do SDK (R4.3/R9.9); este provider apenas obtém o
 * `Meter` nomeado pela aplicação e cria os instrumentos. O nome do serviço
 * (`APPLICATION_NAME`) e o estágio (`APP_STAGE`) são atributos de recurso
 * aplicados no `resource` do Node_SDK (R4.4), compartilhados entre métricas e
 * traces.
 */

import { metrics, type Meter, type MetricOptions } from '@opentelemetry/api';

import { METRIC_KINDS, type MetricKind, type TelemetryConfig } from '../types';

/**
 * Atributos aceitos ao registrar uma medição de métrica. Restringe os valores
 * aos tipos primitivos suportados pela API de métricas do OpenTelemetry.
 */
export type MetricAttributes = Record<string, string | number | boolean>;

/**
 * Handle uniforme de métrica retornado pelo {@link MetricsProvider}.
 *
 * Abstrai a diferença entre os instrumentos OpenTelemetry (contador usa `add`,
 * histograma e gauge usam `record`), expondo uma única operação `record` para
 * o chamador (R4.1).
 */
export interface MetricHandle {
  /**
   * Registra uma medição da métrica, agregada para exportação subsequente (R4.2).
   *
   * @param value Valor numérico da medição.
   * @param attributes Atributos opcionais associados à medição.
   */
  record(value: number, attributes?: MetricAttributes): void;
}

/**
 * Provedor de métricas que registra instrumentos OpenTelemetry a partir de uma
 * {@link TelemetryConfig} (R4, R6).
 */
export class MetricsProvider {
  /** Configuração de telemetria resolvida. */
  private readonly config: TelemetryConfig;

  /** Meter OpenTelemetry nomeado pelo nome da aplicação (R4.4). */
  private readonly meter: Meter;

  /**
   * @param config Configuração de telemetria resolvida pelo Config Loader. O
   *   nome da aplicação (`applicationName`) nomeia o `Meter` obtido.
   */
  constructor(config: TelemetryConfig) {
    this.config = config;
    this.meter = metrics.getMeter(config.applicationName);
  }

  /**
   * Cria/obtém um contador e retorna um handle cujo `record` incrementa o
   * contador via `add` (R4.1).
   *
   * @param name Nome da métrica.
   * @param options Opções do instrumento OpenTelemetry.
   * @returns Um {@link MetricHandle} para registrar incrementos.
   */
  counter(name: string, options?: MetricOptions): MetricHandle {
    const instrument = this.meter.createCounter(name, options);
    return {
      record: (value: number, attributes?: MetricAttributes): void => {
        instrument.add(value, attributes);
      },
    };
  }

  /**
   * Cria/obtém um histograma e retorna um handle cujo `record` registra uma
   * medição via `record` (R4.1).
   *
   * @param name Nome da métrica.
   * @param options Opções do instrumento OpenTelemetry.
   * @returns Um {@link MetricHandle} para registrar medições.
   */
  histogram(name: string, options?: MetricOptions): MetricHandle {
    const instrument = this.meter.createHistogram(name, options);
    return {
      record: (value: number, attributes?: MetricAttributes): void => {
        instrument.record(value, attributes);
      },
    };
  }

  /**
   * Cria/obtém um medidor (gauge) e retorna um handle cujo `record` registra o
   * valor corrente via `record` (R4.1).
   *
   * @param name Nome da métrica.
   * @param options Opções do instrumento OpenTelemetry.
   * @returns Um {@link MetricHandle} para registrar valores.
   */
  gauge(name: string, options?: MetricOptions): MetricHandle {
    const instrument = this.meter.createGauge(name, options);
    return {
      record: (value: number, attributes?: MetricAttributes): void => {
        instrument.record(value, attributes);
      },
    };
  }

  /**
   * Registro genérico de métrica por tipo, despachando para o método
   * apropriado (R4.1). Um tipo fora do conjunto permitido (`counter`,
   * `histogram`, `gauge`) é rejeitado com um erro descritivo que identifica o
   * tipo inválido informado (R4.6).
   *
   * @param kind Tipo da métrica a registrar.
   * @param name Nome da métrica.
   * @param options Opções do instrumento OpenTelemetry.
   * @returns Um {@link MetricHandle} para registrar medições.
   * @throws {Error} Quando `kind` não pertence ao conjunto de tipos permitidos.
   */
  register(kind: MetricKind, name: string, options?: MetricOptions): MetricHandle {
    switch (kind) {
      case 'counter':
        return this.counter(name, options);
      case 'histogram':
        return this.histogram(name, options);
      case 'gauge':
        return this.gauge(name, options);
      default:
        throw new Error(
          `[telemetry-utils] Tipo de metrica invalido: ` +
            `${kind === undefined ? '(ausente)' : `"${String(kind)}"`}. ` +
            `Valores permitidos: ${METRIC_KINDS.join(', ')}.`,
        );
    }
  }
}
