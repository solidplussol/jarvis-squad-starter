// MODIFIED 2026-11-07 for Connected AI Brain Lab project-only isolation
// (see MODIFICATIONS). With JARVIS_PROJECT_MODE=1 ports, bind host, fs access
// and Host/Origin checks come from server/config.ts and ~/.jarvis-config.yaml
// is never read. Without it the original upstream behaviour is preserved.
import { defineConfig, type Plugin } from 'vite'
import fs from 'fs'
import path from 'path'
import os from 'os'
import yaml from 'js-yaml'
import { fileURLToPath } from 'url'
import { resolveConfig, buildViteServerOptions, buildVitePreviewOptions, type ProjectConfig } from './server/config'
import { evaluateRequest, isForbiddenDevFsRequest, transformHtmlForProjectMode } from './server/request-guard'

const resolved = resolveConfig({ appDir: path.dirname(fileURLToPath(import.meta.url)) })

function projectModePlugin(cfg: ProjectConfig): Plugin {
  type Mw = { use: (fn: (req: any, res: any, next: () => void) => void) => void }
  const guard = (middlewares: Mw) => {
    middlewares.use((req, res, next) => {
      const verdict = evaluateRequest({
        method: req.method,
        host: req.headers.host,
        origin: req.headers.origin,
        allowedHostHeaders: cfg.uiHostHeaders,
        allowedOrigins: cfg.allowedOrigins,
      })
      if (!verdict.allow) {
        res.statusCode = verdict.status
        res.setHeader('Content-Type', 'text/plain')
        res.end(verdict.reason)
        return
      }
      if (isForbiddenDevFsRequest(req.url, cfg.appDir, cfg.vaultPath)) {
        res.statusCode = 403
        res.setHeader('Content-Type', 'text/plain')
        res.end('Direct filesystem access is disabled in project mode')
        return
      }
      next()
    })
  }
  return {
    name: 'jarvis-project-isolation',
    configureServer(server) {
      guard(server.middlewares)
      // Vite's HMR WebSocket checks Host and token but not Origin; add the Origin allow-list here.
      server.httpServer?.prependListener('upgrade', (req, socket) => {
        const verdict = evaluateRequest({
          method: 'GET',
          host: req.headers.host,
          origin: req.headers.origin,
          allowedHostHeaders: cfg.uiHostHeaders,
          allowedOrigins: cfg.allowedOrigins,
        })
        if (!verdict.allow) {
          socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
          socket.destroy()
        }
      })
    },
    configurePreviewServer(server) { guard(server.middlewares) },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => transformHtmlForProjectMode(html, cfg.uiPort),
    },
  }
}

function upstreamConfig() {
  // Read port from YAML config file
  const YAML_CONFIG_PATH = path.join(os.homedir(), '.jarvis-config.yaml')
  const DEFAULT_API_PORT = 3002
  const DEFAULT_VITE_PORT = 5173

  let apiPort = DEFAULT_API_PORT
  let vitePort = DEFAULT_VITE_PORT
  try {
    const raw = fs.readFileSync(YAML_CONFIG_PATH, 'utf-8')
    const cfg = yaml.load(raw) as any
    if (cfg?.server?.port && typeof cfg.server.port === 'number') {
      apiPort = cfg.server.port
    }
    if (cfg?.vite?.port && typeof cfg.vite.port === 'number') {
      vitePort = cfg.vite.port
    }
  } catch {
    // Config missing or malformed — use defaults
  }

  return defineConfig({
    define: { __JARVIS_PROJECT_MODE__: 'false' },
    ...vitestOptions,
    server: {
      port: vitePort,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      },
    },
  })
}

const vitestOptions: Record<string, unknown> = {
  test: {
    // tests/ holds Playwright specs and the node:test isolation suite; neither is a vitest suite
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/**'],
  },
}

export default resolved.mode === 'project'
  ? defineConfig({
      define: { __JARVIS_PROJECT_MODE__: 'true' },
      plugins: [projectModePlugin(resolved)],
      server: buildViteServerOptions(resolved),
      preview: buildVitePreviewOptions(resolved),
      ...vitestOptions,
    })
  : upstreamConfig()
