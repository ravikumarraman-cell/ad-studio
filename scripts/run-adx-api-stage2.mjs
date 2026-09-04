import { loadLocalEnv } from './load-local-env.mjs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

// Read the explicit local policy before deciding whether to preserve a
// corporate CA bundle for outbound GitHub and model-provider requests.
await loadLocalEnv(new URL('../.env.local', import.meta.url))
const hasCustomCertificateBundle = process.env.NODE_EXTRA_CA_CERTS || process.env.SSL_CERT_FILE

if (hasCustomCertificateBundle && process.env.ADX_PRESERVE_CUSTOM_TLS_CA !== '1' && process.env.ADX_TLS_ENV_SANITIZED !== '1') {
	const environment = { ...process.env, ADX_TLS_ENV_SANITIZED: '1' }
	delete environment.NODE_EXTRA_CA_CERTS
	delete environment.SSL_CERT_FILE
	const child = spawn(process.execPath, [process.argv[1]], { env: environment, stdio: 'inherit' })
	const [exitCode, signal] = await once(child, 'exit')
	process.exitCode = exitCode ?? (signal ? 1 : 0)
} else {
	await import('../apps/adx-api/server.mjs')
}
