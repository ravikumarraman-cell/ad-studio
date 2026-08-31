import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import styles from '../styles.css?url'

export const Route = createRootRoute({
  component: Root,
  head: () => ({ links: [{ rel: 'stylesheet', href: styles }] }),
})

function Root() {
  return <html lang="en"><head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Health-X</title><HeadContent /></head><body><Outlet /><Scripts /></body></html>
}