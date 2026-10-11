/**
 * Teste unitário — resiliência de transporte do LoggerService.
 *
 * R1.10: WHEN um erro ocorre em um transporte de log, THE Logger SHALL registrar
 * o erro no console de erro e continuar a operação sem interromper a emissão dos
 * demais registros.
 *
 * Estratégia (example-based, conforme a Testing Strategy do design — R1.10 é
 * classificado como EXAMPLE/SMOKE): monta-se um LoggerService real e anexa-se:
 *   1. um transporte "defeituoso" cujo `log()` emite um evento `'error'` (ou
 *      lança), simulando um backend indisponível (ex.: Loki/OTLP fora do ar);
 *   2. um transporte capturador saudável que acumula cada registro recebido.
 *
 * O winston reemite o evento `'error'` do transporte no próprio logger; o
 * listener `this.on('error', ...)` instalado pelo LoggerService (R1.10) deve
 * registrar no `console.error` sem derrubar o processo. Em seguida, emite-se um
 * novo registro e verifica-se que o transporte saudável continua recebendo
 * registros (a emissão dos demais registros não é interrompida).
 *
 * Para evitar que uma exceção não tratada derrube o runner, instalamos um
 * listener de erro adicional de teste que apenas conta as ocorrências; o
 * objetivo é observar o `console.error` do listener do LoggerService (R1.10).
 */

import * as winston from 'winston';
import Transport from 'winston-transport';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoggerService } from './logger-service';

const originalEnv = process.env;

beforeEach(() => {
  // Ambiente isolado: console JSON, sem Loki/Kubernetes, para manter o teste
  // determinístico e focado na resiliência do transporte.
  process.env = {
    ...originalEnv,
    LOG_FORMAT: 'json',
    LOKI_TRANSPORT: 'false',
    KUBERNETES: 'false',
  };
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

/**
 * Transporte que simula um backend indisponível: ao receber um registro, emite
 * um evento `'error'` (comportamento típico de transportes de rede do winston,
 * ex.: `winston-loki`/OTLP quando o destino está fora do ar). O registro é
 * considerado "logado" (callback chamado) para não bloquear o pipeline.
 */
class FailingTransport extends Transport {
  public attempts = 0;

  log(info: winston.Logform.TransformableInfo, callback: () => void): void {
    this.attempts += 1;
    // Emite o erro de forma assíncrona, como fariam os transportes de I/O reais.
    setImmediate(() => {
      this.emit('error', new Error('transporte indisponível (Loki/OTLP)'));
    });
    callback();
  }
}

/** Transporte saudável in-memory: acumula cada registro recebido. */
class CapturingTransport extends Transport {
  public readonly records: winston.Logform.TransformableInfo[] = [];

  log(info: winston.Logform.TransformableInfo, callback: () => void): void {
    this.records.push(info);
    callback();
  }
}

describe('LoggerService — resiliência de transporte (R1.10)', () => {
  it('loga o erro de transporte no console de erro sem derrubar o processo', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = new LoggerService('ResilienceContext', 'verbose', 'test-stage', 'test-service');
    const failing = new FailingTransport({ level: 'verbose' });
    logger.add(failing);

    // Emite um registro: o transporte defeituoso vai emitir 'error'.
    expect(() => logger.info('registro que dispara o erro de transporte')).not.toThrow();

    // Aguarda o ciclo do setImmediate para o evento de erro ser processado.
    await new Promise((resolve) => setImmediate(resolve));

    // O listener on('error') do LoggerService (R1.10) registrou no console de erro.
    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedErrorArgs = consoleErrorSpy.mock.calls.flat();
    const hasTransportError = loggedErrorArgs.some(
      (arg) => arg instanceof Error && arg.message.includes('transporte indisponível'),
    );
    expect(hasTransportError).toBe(true);

    logger.remove(failing);
    logger.close();
  });

  it('continua emitindo os demais registros após um erro de transporte', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const logger = new LoggerService('ResilienceContext', 'verbose', 'test-stage', 'test-service');
    const failing = new FailingTransport({ level: 'verbose' });
    const capturing = new CapturingTransport({ level: 'verbose' });
    logger.add(failing);
    logger.add(capturing);

    // Primeiro registro: aciona o erro no transporte defeituoso e é recebido
    // pelo transporte saudável.
    logger.info('primeiro registro');
    await new Promise((resolve) => setImmediate(resolve));

    expect(capturing.records.length).toBeGreaterThanOrEqual(1);
    const countAfterError = capturing.records.length;

    // Registros subsequentes continuam sendo emitidos normalmente (R1.10).
    logger.warn('segundo registro');
    logger.error('terceiro registro');
    await new Promise((resolve) => setImmediate(resolve));

    expect(capturing.records.length).toBe(countAfterError + 2);

    const messages = capturing.records.map((info) => info.message);
    expect(messages).toContain('primeiro registro');
    expect(messages).toContain('segundo registro');
    expect(messages).toContain('terceiro registro');

    // O transporte defeituoso recebeu todas as tentativas sem interromper o fluxo.
    expect(failing.attempts).toBe(3);

    logger.remove(failing);
    logger.remove(capturing);
    logger.close();
  });
});
