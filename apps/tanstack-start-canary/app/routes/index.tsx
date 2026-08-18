import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  loader: async () => ({ traceId: crypto.randomUUID(), readiness: 'ready' }),
  errorComponent: ({ error }) => <main><h1>Canary safely failed</h1><p>{String(error)}</p></main>,
  component: Canary,
})
function Canary() { const data = Route.useLoaderData(); return <main><h1>ADX TanStack Start compatibility canary</h1><p data-testid="readiness">{data.readiness}</p><p data-testid="trace-id">{data.traceId}</p></main> }
