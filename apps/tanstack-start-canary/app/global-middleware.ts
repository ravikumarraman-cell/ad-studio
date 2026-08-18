export default async function globalMiddleware(event: { node?: { res?: { setHeader(name: string, value: string): void } } }, next: () => Promise<unknown>) {
  event.node?.res?.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'")
  event.node?.res?.setHeader('X-Content-Type-Options', 'nosniff')
  return next()
}
