/**
 * Testes unitários (example-based) do WinstonLogger — Task 5.2.
 *
 * Cobrem exemplos concretos de:
 * - prioridades numéricas dos níveis (`crit`=0 … `verbose`=7) — R1.1;
 * - mapeamento de cores por nível conforme a tabela de design — R1.2;
 * - estilização ANSI de `styled()` — R1.2/R1.4;
 * - saída estilizada de `formatPrint`, incluindo o prefixo `[stage-service]`,
 *   nível colorido, contexto em PascalCase e truncamento do Correlation_Id — R1.4/R1.5.
 */

import { describe, expect, it } from 'vitest';
import type * as winston from 'winston';

import { WinstonLogger } from './winston-logger';

/** Sequência ANSI de reset usada em todas as asserções de estilização. */
const ANSI_RESET = '\u001b[0m';

/**
 * Executa um `winston.Logform.Format` sobre um registro simulado e devolve a
 * string resultante produzida pelo `printf`.
 */
function runFormat(
  format: winston.Logform.Format,
  info: Record<string, unknown>,
): string {
  const transformed = format.transform(info as winston.Logform.TransformableInfo);
  // `printf` sempre retorna um objeto com a mensagem no símbolo MESSAGE do winston,
  // mas o `transform` do printf retorna o próprio info com `info[MESSAGE]` definido.
  // Para `printf`, o retorno útil é a string montada acessível via Symbol.for('message').
  const messageSymbol = Symbol.for('message');
  const result = (transformed as Record<symbol, unknown>)[messageSymbol];
  return String(result);
}

describe('WinstonLogger.levels', () => {
  it('expõe as prioridades numéricas exatas de crit:0 a verbose:7 (R1.1)', () => {
    expect(WinstonLogger.levels).toEqual({
      crit: 0,
      alert: 1,
      http: 2,
      error: 3,
      warn: 4,
      info: 5,
      debug: 6,
      verbose: 7,
    });
  });

  it('ordena crit como maior prioridade (0) e verbose como menor (7)', () => {
    expect(WinstonLogger.levels.crit).toBeLessThan(WinstonLogger.levels.verbose as number);
    expect(WinstonLogger.levels.info).toBe(5);
  });
});

describe('WinstonLogger.colors', () => {
  it('mapeia cada nível para a cor da tabela de design (R1.2)', () => {
    expect(WinstonLogger.colors).toEqual({
      crit: 'bold italic dim red',
      alert: 'bold cyan',
      http: 'bold blue',
      error: 'bold red',
      warn: 'yellow',
      info: 'green',
      debug: 'magenta',
      verbose: 'bold italic dim',
    });
  });

  it('cobre exatamente os mesmos níveis definidos em levels', () => {
    expect(Object.keys(WinstonLogger.colors).sort()).toEqual(
      Object.keys(WinstonLogger.levels).sort(),
    );
  });
});

describe('WinstonLogger.styled', () => {
  it('envolve o texto com código ANSI simples para cor única (info -> verde) (R1.2)', () => {
    // info -> 'green' -> código 32
    expect(WinstonLogger.styled('info', 'hello')).toBe(`\u001b[32mhello${ANSI_RESET}`);
  });

  it('compõe múltiplos códigos ANSI para estilos combinados (crit) (R1.4)', () => {
    // crit -> 'bold italic dim red' -> 1, 3, 2, 31
    expect(WinstonLogger.styled('crit', 'boom')).toBe(
      `\u001b[1m\u001b[3m\u001b[2m\u001b[31mboom${ANSI_RESET}`,
    );
  });

  it('sempre encerra a string estilizada com o reset ANSI', () => {
    const output = WinstonLogger.styled('warn', 'careful');
    expect(output.startsWith('\u001b[33m')).toBe(true); // yellow = 33
    expect(output.endsWith(ANSI_RESET)).toBe(true);
  });
});

describe('WinstonLogger.formatPrint', () => {
  it('produz saída estilizada com prefixo [service], PID, data BR, nível MAIÚSCULO e mensagem (R1.4)', () => {
    const format = WinstonLogger.formatPrint('prod');
    const line = runFormat(format, {
      level: 'info',
      service: 'orders',
      pid: 12345,
      timestamp: '2024-01-01T10:20:30.000Z',
      message: 'order created',
    });

    // Prefixo [service] colorido (verde) — sem o stage no prefixo.
    expect(line).toContain(WinstonLogger.styled('info', '[orders]'));
    // PID presente.
    expect(line).toContain('12345');
    // Data no formato DD/MM/YYYY HH:mm:ss (a hora depende do fuso; valida padrão).
    expect(line).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/);
    // Nível em MAIÚSCULAS, alinhado (padEnd 7) e colorido.
    expect(line).toContain(WinstonLogger.styled('info', 'INFO   '));
    // Mensagem ao final.
    expect(line).toContain('order created');
  });

  it('inclui o contexto em PascalCase (colorido) quando presente (R1.4)', () => {
    const format = WinstonLogger.formatPrint('dev');
    const line = runFormat(format, {
      level: 'warn',
      service: 'orders',
      timestamp: '2024-01-01T00:00:00.000Z',
      message: 'slow query',
      context: 'order-service',
    });

    expect(line).toContain(WinstonLogger.styled('info', '[orders]'));
    expect(line).toContain(WinstonLogger.styled('info', '[OrderService]'));
    // Nível WARN em maiusculo e alinhado.
    expect(line).toContain(WinstonLogger.styled('warn', 'WARN   '));
  });

  it('trunca o Correlation_Id nos últimos 7 caracteres quando possui mais de 7 (R1.4)', () => {
    const format = WinstonLogger.formatPrint('prod');
    const line = runFormat(format, {
      level: 'info',
      service: 'orders',
      timestamp: '2024-01-01T00:00:00.000Z',
      message: 'done',
      correlationId: 'abcdef1234567890', // 16 chars -> últimos 7 = '4567890'
    });

    expect(line).toContain('(4567890)');
    expect(line).not.toContain('abcdef1234567890');
  });

  it('mantém o Correlation_Id integral quando possui 7 caracteres ou menos (R1.4)', () => {
    const format = WinstonLogger.formatPrint('prod');
    const line = runFormat(format, {
      level: 'info',
      service: 'orders',
      timestamp: '2024-01-01T00:00:00.000Z',
      message: 'done',
      correlationId: 'abc123', // 6 chars -> integral
    });

    expect(line).toContain('(abc123)');
  });
});
