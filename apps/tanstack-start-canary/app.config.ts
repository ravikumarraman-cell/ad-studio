import { defineConfig } from '@tanstack/react-start/config'

export default defineConfig({
  server: { preset: 'node-server' },
  tsr: { appDirectory: './app', routesDirectory: './app/routes', generatedRouteTree: './app/routeTree.gen.ts' },
})
