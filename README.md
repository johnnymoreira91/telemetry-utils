# @flexicorp/telemetry-utils

Biblioteca de telemetria unificada para projetos da organização: **logs** (Winston), **métricas** e **tracing** (OpenTelemetry), com correlação automática por requisição e exportação via OTLP HTTP para OTel Collector ou Grafana Alloy.

- Logger estruturado (base `@engebras/lib-logger`) com níveis customizados, cores e console estilizado/JSON. Configurado por variáveis de ambiente.
- Correlação de requisições via `AsyncLocalStorage` (`correlationId` / `keyId`).
- Injeção automática de `traceId` / `spanId` nos logs quando há span ativo.
- Métricas (counter, histogram, gauge) e spans sobre a API do OpenTelemetry.
- Bootstrap do OpenTelemetry Node SDK por efeito colateral, ativado em Kubernetes.

> Requer **Node.js >= 20**.

---

## Instalação

```bash
npm install @flexicorp/telemetry-utils @opentelemetry/api
```

`@opentelemetry/api` é uma **peerDependency** e precisa ser instalada no projeto que consome a lib.

---

## Pontos de entrada

A lib expõe dois pontos de entrada:

| Import | Conteúdo | Efeito colateral |
| --- | --- | --- |
| `@flexicorp/telemetry-utils` | Classes públicas e tipos (`LoggerService`, `Namespace`, `MetricsProvider`, `TracerProvider`, ...) | Nenhum |
| `@flexicorp/telemetry-utils/tracing` | Bootstrap do OpenTelemetry Node SDK | **Sim** — inicializa o SDK ao ser importado |

O import da raiz **nunca** inicia o SDK. A inicialização do SDK acontece exclusivamente ao importar o subcaminho `/tracing`.

---

## Inicialização do tracing (bootstrap)

Para que as auto-instrumentações (HTTP, Winston, runtime do Node) funcionem, o bootstrap deve ser **a primeira coisa importada** no ponto de entrada do serviço, antes de qualquer módulo instrumentado.

```ts
// index.ts — PRIMEIRA linha do processo
import '@flexicorp/telemetry-utils/tracing';

// só então o restante da aplicação
import { startServer } from './server';

startServer();
```

Com CommonJS:

```js
require('@flexicorp/telemetry-utils/tracing');
require('./server');
```

Comportamento do bootstrap:

- Carrega variáveis de ambiente via `dotenv` como primeira instrução.
- Configura o nível de diagnóstico do OpenTelemetry a partir de `OTEL_LOG_LEVEL` (default `WARN`).
- **Só inicia o Node SDK quando `KUBERNETES === 'true'`.** Em qualquer outro valor, registra no console que a telemetria foi ignorada (modo local) e **não** inicia o SDK.
- Registra handlers de `SIGTERM`/`SIGINT` para encerramento gracioso.
- A auto-instrumentação do Winston fica apenas com a correlação de contexto
  (`disableLogSending: true`); o envio dos logs é feito pelo transporte do
  próprio `LoggerService`, evitando duplicação.

---

## Configuração por variáveis de ambiente

Toda a configuração é resolvida a partir do ambiente, com defaults aplicados.

> O `LoggerService` lê estas variáveis diretamente de `process.env`. O bootstrap
> do SDK e os provedores de métricas/tracing usam as mesmas variáveis (via
> `TelemetryConfig`).

### Identificação do serviço

| Variável | Default | Descrição |
| --- | --- | --- |
| `APPLICATION_NAME` | `unknown-service` | Nome do serviço (`service.name`). |
| `APP_STAGE` | `unknown-stage` | Estágio/ambiente (`deployment.environment`). |
| `SERVICE_NAMESPACE` | `ecs` | Namespace do serviço (`service_namespace`). |

### Logs

| Variável | Default | Descrição |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | Nível mínimo de emissão. Valores válidos abaixo. |
| `LOG_FORMAT` | `text` | `text` ou `message` → console estilizado; `json` → console JSON. |

Níveis de log (prioridade crescente — emite quando `prioridade(registro) <= prioridade(LOG_LEVEL)`):

| Nível | Prioridade |
| --- | --- |
| `crit` | 0 |
| `alert` | 1 |
| `http` | 2 |
| `error` | 3 |
| `warn` | 4 |
| `info` | 5 |
| `debug` | 6 |
| `verbose` | 7 |

### Loki

| Variável | Default | Descrição |
| --- | --- | --- |
| `LOKI_TRANSPORT` | `false` | Habilita o transporte Loki apenas quando igual a `true`. |
| `LOKI_HOST` | `http://loki.infra.svc.cluster.local:3100` | Host do Loki quando o transporte está habilitado. |

### Exportação OTLP (traces, logs, metrics)

| Variável | Default |
| --- | --- |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | `http://otel-collector.infra.svc.cluster.local:4318/v1/traces` |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | `http://otel-collector.infra.svc.cluster.local:4318/v1/logs` |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | `http://otel-collector.infra.svc.cluster.local:4318/v1/metrics` |

### Destino de exportação por sinal

| Variável | Default | Valores |
| --- | --- | --- |
| `EXPORT_TARGET_TRACES` | `otlp` | `otlp` ou `alloy` |
| `EXPORT_TARGET_METRICS` | `otlp` | `otlp` ou `alloy` |

Quando um sinal usa `alloy`, o host efetivo vem de `OTEL_EXPORTER_ALLOY_TRACES_ENDPOINT` / `OTEL_EXPORTER_ALLOY_METRICS_ENDPOINT`, com fallback para `http://alloy.infra.svc.cluster.local:4318/v1/{signal}`. Um valor inválido (diferente de `otlp`/`alloy`) causa erro na inicialização.

### Diagnóstico e ativação do SDK

| Variável | Default | Descrição |
| --- | --- | --- |
| `OTEL_LOG_LEVEL` | `WARN` | Diagnóstico do OTel: `NONE`, `ERROR`, `WARN`, `INFO`, `DEBUG`, `VERBOSE`, `ALL`. |
| `KUBERNETES` | — | Inicia o Node SDK somente quando igual a `true`. |

Exemplo de `.env`:

```env
APPLICATION_NAME=orders-service
APP_STAGE=production
SERVICE_NAMESPACE=commerce
KUBERNETES=true

LOG_LEVEL=info
LOG_FORMAT=json

LOKI_TRANSPORT=true
LOKI_HOST=http://loki.infra.svc.cluster.local:3100
```

---

## Logging — `LoggerService`

O `LoggerService` lê a configuração diretamente das variáveis de ambiente
(`LOG_LEVEL`, `LOG_FORMAT`, `APPLICATION_NAME`, `APP_STAGE`, `LOKI_TRANSPORT`,
`LOKI_HOST`). Apenas o `context` é obrigatório.

```ts
import { LoggerService } from '@flexicorp/telemetry-utils';

const logger = new LoggerService('OrdersController');

logger.info('pedido criado', { orderId: 'abc-123' });
logger.warn('estoque baixo');
logger.error('falha ao processar pagamento', { code: 'E_PAYMENT' });
logger.debug('payload recebido');
```

Assinatura do construtor:

```ts
new LoggerService(
  context: string,   // rótulo do módulo/controller (ex.: 'OrdersController')
  logLevel?: string, // default: process.env.LOG_LEVEL (ou 'info')
  stage?: string,    // default: process.env.APP_STAGE
  service?: string,  // default: process.env.APPLICATION_NAME (ou 'unknown-service')
)
```

Métodos por nível disponíveis: `crit`, `alert`, `http`, `error`, `warn`, `info`,
`debug`, `verbose`.

### Transports

| Transport | Quando | O que envia |
| --- | --- | --- |
| Console | sempre | Console estilizado (`LOG_FORMAT` `text`/`message`) ou JSON (demais valores). |
| OpenTelemetry (`OpenTelemetryTransportV3`) | sempre | Logs via OTLP (para o Collector/Alloy) quando o Node SDK está ativo. |
| Loki (`winston-loki`) | `LOKI_TRANSPORT=true` | Push nativo ao Loki em `LOKI_HOST` (batching a cada 5s). |

Cada registro inclui `timestamp`, `level`, `service` e `message`. Quando há
escopo de `Namespace` ativo, inclui `correlationId`/`keyId`; quando há span
ativo, inclui `traceId`/`spanId` (correlação automática).

Formato do console estilizado (`LOG_FORMAT=text`):

```
[Stage-Service] <puid>  - DD/MM/YYYY HH:mm:ss  NIVEL (Context) mensagem
```

- `[Stage-Service]` em PascalCase (amarelo);
- `<puid>`: últimos 7 caracteres do `correlationId` (ou do PID quando não há escopo);
- nível colorido e alinhado; mensagem colorida conforme o nível;
- em `crit`/`error`/`debug`, dados adicionais são anexados via `util.inspect`.

Um erro em qualquer transporte (ex.: Loki/OTLP indisponível) é logado no console
de erro **sem derrubar o processo**.

### `withTrace` — envolver uma operação em um span

```ts
const result = await logger.withTrace('processarPedido', async (span) => {
  span.setAttribute('order.id', 'abc-123');
  return await processar();
});
```

- Cria um span ativo nomeado e emite um log `Iniciando trace: <name>`.
- Em sucesso: define o status do span como OK, encerra-o e retorna o valor.
- Em exceção: registra a exceção no span (`recordException`), marca status de
  erro, loga o erro, encerra o span e **repropaga** a exceção.

---

## Correlação por requisição — `Namespace`

Baseado em `AsyncLocalStorage`: cada escopo criado com `run()` é isolado entre execuções concorrentes. Use a instância default `namespace`.

```ts
import { namespace, LoggerService } from '@flexicorp/telemetry-utils';

const logger = new LoggerService('Http');

// middleware HTTP (exemplo)
function requestContext(req, res, next) {
  namespace.run(() => {
    namespace.setRequestId(req.headers['x-correlation-id'] ?? crypto.randomUUID());
    namespace.setkeyId(req.headers['x-api-key']);
    next();
  });
}

// dentro do escopo, os logs ganham correlationId/keyId automaticamente
logger.info('handling request');
```

API da instância:

| Método | Descrição |
| --- | --- |
| `run(fn)` | Executa `fn` em um escopo isolado. |
| `isActived()` | `true` se há escopo ativo. |
| `setRequestId(value)` | Define o `correlationId` do escopo (no-op fora de escopo). |
| `getRequestId()` | Lê o `correlationId` (ou `null`). |
| `setkeyId(value)` | Define o `keyId` do escopo (no-op fora de escopo). |
| `getkeyId()` | Lê o `keyId` (ou `undefined`). |

> Fora de um escopo ativo, as escritas são ignoradas silenciosamente e não interrompem a execução.

---

## Métricas — `MetricsProvider`

`MetricsProvider` e `TracerProvider` recebem um `TelemetryConfig` no construtor. Monte-o a partir das variáveis de ambiente do seu serviço:

```ts
import type { TelemetryConfig } from '@flexicorp/telemetry-utils';

const config: TelemetryConfig = {
  applicationName: process.env.APPLICATION_NAME ?? 'orders-service',
  stage: process.env.APP_STAGE ?? 'production',
  serviceNamespace: process.env.SERVICE_NAMESPACE ?? 'commerce',
  logLevel: 'info',
  logFormat: 'json',
  lokiTransport: false,
  lokiHost: 'http://loki.infra.svc.cluster.local:3100',
  kubernetes: process.env.KUBERNETES === 'true',
  otelLogLevel: 'WARN',
  otlpEndpoints: {
    traces: 'http://otel-collector.infra.svc.cluster.local:4318/v1/traces',
    logs: 'http://otel-collector.infra.svc.cluster.local:4318/v1/logs',
    metrics: 'http://otel-collector.infra.svc.cluster.local:4318/v1/metrics',
  },
  exportTargets: { traces: 'otlp', metrics: 'otlp' },
};
```

```ts
import { MetricsProvider } from '@flexicorp/telemetry-utils';

const metrics = new MetricsProvider(config); // config montado acima

const requests = metrics.counter('http_requests_total');
requests.record(1, { route: '/orders', method: 'GET' });

const latency = metrics.histogram('http_request_duration_ms');
latency.record(42, { route: '/orders' });

const inflight = metrics.gauge('http_inflight_requests');
inflight.record(7);

// forma genérica por tipo
const handle = metrics.register('counter', 'jobs_processed_total');
handle.record(1);
```

- `counter(name, options?)`, `histogram(name, options?)`, `gauge(name, options?)` retornam um `MetricHandle` com `record(value, attributes?)`.
- `register(kind, name, options?)` despacha por tipo; um `kind` inválido lança erro descritivo.

Atributos aceitos: `Record<string, string | number | boolean>`.

A agregação e a exportação (intervalo de 60s) são gerenciadas pelo Node SDK quando o bootstrap está ativo.

---

## Tracing — `TracerProvider`

```ts
import { TracerProvider } from '@flexicorp/telemetry-utils';

const tracer = new TracerProvider(config); // config: TelemetryConfig

// span manual
const span = tracer.startSpan('consulta-db');
try {
  // ...
} finally {
  span.end();
}

// span ativo (vincula filhos automaticamente ao contexto do pai)
const total = tracer.startActiveSpan('calcularTotal', (span) => {
  span.setAttribute('items', 3);
  const r = 100;
  span.end();
  return r;
});
```

- `startSpan(name, options?)` valida o nome (1 a 255 caracteres) antes de criar o span.
- `startActiveSpan(name, fn)` torna o span ativo durante `fn`; spans criados dentro herdam o `traceId` do pai.

---

## Tipos públicos

```ts
import type {
  TelemetryConfig,
  ExportTarget,  // 'alloy' | 'otlp'
  LogLevel,      // 'crit' | 'alert' | 'http' | 'error' | 'warn' | 'info' | 'debug' | 'verbose'
  LogFormat,     // 'json' | 'text' | 'message'
  MetricKind,    // 'counter' | 'histogram' | 'gauge'
  MetricHandle,
  MetricAttributes,
} from '@flexicorp/telemetry-utils';
```

---

## Exemplo completo

```ts
// index.ts
import '@flexicorp/telemetry-utils/tracing'; // 1º import, inicia o SDK em k8s

import { LoggerService, namespace } from '@flexicorp/telemetry-utils';

const logger = new LoggerService('App');

async function main() {
  namespace.run(async () => {
    namespace.setRequestId('req-001');

    await logger.withTrace('bootstrap', async (span) => {
      span.setAttribute('phase', 'startup');
      logger.info('serviço iniciado'); // inclui correlationId, traceId e spanId
    });
  });
}

main();
```

---

## Desenvolvimento

```bash
npm install     # instala dependências
npm test        # roda os testes (vitest)
npm run build   # build com tsup (gera dist/ CJS + .d.ts)
```
