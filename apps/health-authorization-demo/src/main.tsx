import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FeatureDelivery } from './feature-delivery'
import './styles.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } })

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><a className="adx-global-home" href="/" aria-label="Return to ADX home and choose a mode">⌂ <span>Home</span></a><FeatureDelivery /></QueryClientProvider></React.StrictMode>,
)
