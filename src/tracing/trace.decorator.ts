import { SpanStatusCode, trace, type Span } from '@opentelemetry/api';

export interface TraceClassOptions {
  /**
   * Prefixo do Span (ex: 'LOGIC', 'SERVICE', 'CONTROLLER').
   * Se omitido, detecta automaticamente pelo sufixo do nome da classe:
   * - Nome terminando em 'Logic' -> '[LOGIC]'
   * - Nome terminando em 'Service' -> '[SERVICE]'
   * - Nome terminando em 'Controller' -> '[CONTROLLER]'
   */
  prefix?: string;
  /** Nomes de métodos que NÃO devem ser instrumentados. */
  ignore?: string[];
}

export interface TraceOptions {
  /**
   * Nome do Span. Se não informado, utiliza o nome do método decorado ou
   * `${ClassName}.${methodName}`.
   */
  name?: string;
  /** Atributos customizados adicionais para o Span. */
  attributes?: Record<string, unknown>;
}

function resolvePrefix(className: string, customPrefix?: string): string {
  if (customPrefix) {
    const clean = customPrefix.replace(/[\[\]]/g, '').trim().toUpperCase();
    return `[${clean}]`;
  }
  if (className.endsWith('Logic')) return '[LOGIC]';
  if (className.endsWith('Service')) return '[SERVICE]';
  if (className.endsWith('Controller')) return '[CONTROLLER]';
  return `[${className.toUpperCase()}]`;
}

/**
 * Decorator de CLASSE que instrumenta automaticamente TODOS os métodos da classe
 * (síncronos e assíncronos) como Spans ativos do OpenTelemetry.
 *
 * @example
 * ```typescript
 * @TraceClass('LOGIC')
 * export class HealthMapLogic {
 *   async getHealthMap(payload) { ... } // gera span: "[LOGIC] - HealthMapLogic.getHealthMap"
 *   async getLifeUpData() { ... }       // gera span: "[LOGIC] - HealthMapLogic.getLifeUpData"
 * }
 * ```
 */
export function TraceClass(prefixOrOptions?: string | TraceClassOptions): ClassDecorator {
  const options: TraceClassOptions =
    typeof prefixOrOptions === 'string'
      ? { prefix: prefixOrOptions }
      : prefixOrOptions || {};

  return function (target: any) {
    const className = target.name || 'AnonymousClass';
    const prefix = resolvePrefix(className, options.prefix);
    const ignoreList = new Set(options.ignore || []);
    const proto = target.prototype;

    if (!proto) return;

    const propertyNames = Object.getOwnPropertyNames(proto);
    for (const propertyName of propertyNames) {
      if (propertyName === 'constructor' || ignoreList.has(propertyName)) {
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(proto, propertyName);
      if (!descriptor || typeof descriptor.value !== 'function') {
        continue;
      }

      const originalMethod = descriptor.value;
      const spanName = `${prefix} - ${className}.${propertyName}`;

      descriptor.value = function (this: any, ...args: any[]) {
        const tracerName = process.env.APPLICATION_NAME || '@flexicorp/telemetry-utils';
        const tracer = trace.getTracer(tracerName);

        return tracer.startActiveSpan(spanName, (span: Span) => {
          span.setAttributes({
            'code.function': propertyName,
            'code.namespace': className,
          });

          try {
            const result = originalMethod.apply(this, args);

            if (result && typeof result.then === 'function') {
              return result
                .then((value: any) => {
                  span.setStatus({ code: SpanStatusCode.OK });
                  span.end();
                  return value;
                })
                .catch((error: unknown) => {
                  span.setStatus({ code: SpanStatusCode.ERROR });
                  span.recordException(
                    error instanceof Error ? error : new Error(String(error)),
                  );
                  span.end();
                  throw error;
                });
            }

            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return result;
          } catch (error) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.recordException(
              error instanceof Error ? error : new Error(String(error)),
            );
            span.end();
            throw error;
          }
        });
      };

      Object.defineProperty(proto, propertyName, descriptor);
    }
  };
}

/**
 * Decorator de MÉTODO para criar um Span ativo para um método individual.
 */
export function Trace(options?: TraceOptions): MethodDecorator {
  return function (
    target: any,
    propertyName: string | symbol,
    descriptor: TypedPropertyDescriptor<any>,
  ) {
    const originalMethod = descriptor.value;
    if (typeof originalMethod !== 'function') {
      return descriptor;
    }

    const className = target?.constructor?.name || 'Class';
    const spanName = options?.name || `${className}.${String(propertyName)}`;

    descriptor.value = function (this: any, ...args: any[]) {
      const tracerName = process.env.APPLICATION_NAME || '@flexicorp/telemetry-utils';
      const tracer = trace.getTracer(tracerName);

      return tracer.startActiveSpan(
        spanName,
        { attributes: options?.attributes as any },
        (span: Span) => {
          span.setAttributes({
            'code.function': String(propertyName),
            'code.namespace': className,
          });

          try {
            const result = originalMethod.apply(this, args);

            if (result && typeof result.then === 'function') {
              return result
                .then((value: any) => {
                  span.setStatus({ code: SpanStatusCode.OK });
                  span.end();
                  return value;
                })
                .catch((error: unknown) => {
                  span.setStatus({ code: SpanStatusCode.ERROR });
                  span.recordException(
                    error instanceof Error ? error : new Error(String(error)),
                  );
                  span.end();
                  throw error;
                });
            }

            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return result;
          } catch (error) {
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.recordException(
              error instanceof Error ? error : new Error(String(error)),
            );
            span.end();
            throw error;
          }
        },
      );
    };

    return descriptor;
  };
}

/**
 * Alias de `@Trace` para compatibilidade retroativa com `@log`.
 */
export const log = Trace;
