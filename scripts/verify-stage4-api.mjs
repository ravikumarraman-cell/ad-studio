import assert from 'node:assert/strict'
import { validateDesignPackage } from '../apps/adx-api/design-governance.mjs'
import { ChangeCaseError } from '../apps/adx-api/change-case-ledger.mjs'
const design={architectureDecision:{decision:'bounded API'},interfaceDelta:{changes:['POST /design']},migrationPlan:{steps:['migrate']},threatModel:{threats:[{id:'T1',mitigation:'auth',residualRisk:'low'}]},dependencies:{items:[{name:'pg',license:'MIT'}]},testStrategy:{layers:['unit','integration']}}
const first=validateDesignPackage(design); const changed=validateDesignPackage({...design,interfaceDelta:{changes:['POST /design','GET /design']}})
assert.notEqual(first.digest,changed.digest)
assert.throws(()=>validateDesignPackage({...design,threatModel:{threats:[{id:'T1'}]}}),(error)=>error instanceof ChangeCaseError&&error.code==='THREAT_MODEL_INVALID')
console.log('Stage 4 PostgreSQL/API contract preflight: complete artifacts, threat-model validation, and stale-design digest invalidation passed.')
