// app.config.ts
import { defineConfig } from "@tanstack/react-start/config";
var app_config_default = defineConfig({
  server: { preset: "node-server" },
  tsr: { appDirectory: "./app", routesDirectory: "./app/routes", generatedRouteTree: "./app/routeTree.gen.ts" }
});
export {
  app_config_default as default
};
