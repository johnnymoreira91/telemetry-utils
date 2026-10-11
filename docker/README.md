# Stack de observabilidade (Docker)

Stack local para receber e visualizar a telemetria emitida por serviços que usam
`@flexicorp/telemetry-utils`: **Alloy** (ingestão OTLP), **Tempo** (traces),
**Prometheus** (métricas), **Loki** (logs) e **Grafana** (visualização).

## Subir

```bash
cd docker
docker compose up -d
```

Para acompanhar os logs: `docker compose logs -f alloy` (ou qualquer serviço).
Para derrubar: `docker compose down` (adicione `-v` para apagar os volumes/dados).

## Fluxo

```
App --(OTLP HTTP :4318 / gRPC :4317)--> Alloy ---> Tempo       (traces)
                                              ---> Prometheus  (metrics, remote_write)
                                              ---> Loki        (logs)
Grafana consulta Tempo, Prometheus e Loki.
```

## Portas (host)

| Serviço | Porta | Uso |
| --- | --- | --- |
| Alloy | `4317` | OTLP gRPC |
| Alloy | `4318` | OTLP HTTP (`/v1/traces`, `/v1/metrics`, `/v1/logs`) |
| Alloy | `12345` | UI do Alloy |
| Tempo | `3200` | API de query |
| Loki | `3100` | push + query |
| Prometheus | `9090` | UI/query |
| Grafana | `3001` | UI (login: `admin` / `admin`, anônimo habilitado) |

> O Grafana usa **3001** no host para não colidir com a POC Express (3000).

## Apontar a aplicação para esta stack

No `.env` do serviço (ex.: `poc-express-telemetry`), use o host onde esta stack
está rodando. Para a stack em `192.168.0.28`:

```env
KUBERNETES=true
EXPORT_TARGET_TRACES=otlp
EXPORT_TARGET_METRICS=otlp
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://192.168.0.28:4318/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://192.168.0.28:4318/v1/metrics
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://192.168.0.28:4318/v1/logs
LOKI_TRANSPORT=false
```

Com esta stack, os três sinais são aceitos via OTLP no Alloy (não é necessário o
transporte Loki nativo; os logs chegam ao Loki através do Alloy).

## Validar a ingestão

```bash
# traces
curl -i -X POST http://localhost:4318/v1/traces \
  -H 'content-type: application/json' \
  -d '{"resourceSpans":[{"scopeSpans":[{"spans":[{"traceId":"5b8aa5a2d2c872e8321cf37308d69df2","spanId":"051581bf3cb55c13","name":"probe","kind":1,"startTimeUnixNano":"1700000000000000000","endTimeUnixNano":"1700000000000000001"}]}]}]}'

# metrics e logs: trocar o path para /v1/metrics e /v1/logs
```

Esperado: `HTTP 200` com corpo `{"partialSuccess":{}}`.

## Notas

- Volumes nomeados (`*-data`) persistem traces/logs/métricas entre reinícios.
  Use `docker compose down -v` para zerar.
- O Tempo gera métricas RED (span-metrics e service-graphs) e faz `remote_write`
  para o Prometheus; por isso o `--web.enable-remote-write-receiver` está ligado.
- Versões fixadas nas imagens para builds reprodutíveis.
