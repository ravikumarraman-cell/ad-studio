import { hydrateRoot } from 'react-dom/client'
import { StartClient } from '@tanstack/react-start/client'
import { getRouter } from './router'

function startClient() {
  hydrateRoot(document, <StartClient router={getRouter()} />)
}

startClient()

export default startClient