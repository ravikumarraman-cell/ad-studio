import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
const server = createServer((request, response) => {
  const traceId = request.headers['x-trace-id'] || randomUUID()
  response.setHeader('content-type', 'application/json'); response.setHeader('x-trace-id', traceId)
  if (request.url === '/healthz') { response.end(JSON.stringify({ status: 'ok', service: 'adx-api', traceId })); return }
  if (request.url === '/readyz') { response.end(JSON.stringify({ status: 'ready', dependencies: ['postgres', 'object-store'], traceId })); return }
  response.statusCode = 404; response.end(JSON.stringify({ code: 'NOT_FOUND', traceId }))
})
server.listen(process.env.PORT || 3100, '127.0.0.1', () => console.log(JSON.stringify({ service: 'adx-api', event: 'listening', traceId: randomUUID() })))
