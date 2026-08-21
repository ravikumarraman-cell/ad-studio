import { hydrateRoot } from 'react-dom/client'
import { StartClient } from '@tanstack/react-start/client'
import { getRouter } from './router'

export default function startClient() {
  hydrateRoot(document, <StartClient router={getRouter()} />)
}