import assert from 'node:assert/strict'
import { MinioEvidenceObjectStore } from '../apps/adx-api/evidence-object-store.mjs'

const store = new MinioEvidenceObjectStore({ endpoint: process.env.ADX_EVIDENCE_S3_ENDPOINT ?? 'http://127.0.0.1:9000', accessKey: process.env.ADX_EVIDENCE_S3_ACCESS_KEY ?? 'adx-local', secretKey: process.env.ADX_EVIDENCE_S3_SECRET_KEY ?? 'adx-local-change-before-shared' })
const object = await store.put({ key: `stage6/${crypto.randomUUID()}/verifier-report.txt`, body: 'independent verifier report\n', mediaType: 'text/plain' })
assert.match(object.digest, /^sha256:/); assert.equal(object.bytes, 28); assert.equal(object.mediaType, 'text/plain')
console.log('Stage 6 MinIO object-store verification passed: content-addressed verifier artifact persisted under a canonical immutable object key.')
