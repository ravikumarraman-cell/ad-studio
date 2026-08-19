import assert from 'node:assert/strict'
import { validateDesignPackage } from '../apps/adx-api/design-governance.mjs'
import { ChangeCaseError } from '../apps/adx-api/change-case-ledger.mjs'
assert.throws(() => validateDesignPackage({}), (e) => e instanceof ChangeCaseError && e.code === 'DESIGN_ARTIFACTS_INCOMPLETE')
const design={architectureDecision:{decision:'bounded API'},interfaceDelta:{changes:['POST /design']},migrationPlan:{steps:['migrate']},threatModel:{threats:[{id:'T1',mitigation:'auth',residualRisk:'low'}]},dependencies:{items:[{name:'pg',license:'MIT'}]},testStrategy:{layers:['unit','integration']}}
const a=validateDesignPackage(design),b=validateDesignPackage({...design,testStrategy:{layers:['unit','browser']}});assert.notEqual(a.digest,b.digest);console.log('Stage 4 design package completeness and material-digest-change verification passed.')
