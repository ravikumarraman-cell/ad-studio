import workflowContract from '../../../packages/domain/src/change-case-workflow.json'

export const gates = workflowContract.gates
export type GateStatus = 'complete' | 'current' | 'waiting'

export function workflowPosition(state: string) {
  return workflowContract.statePositions[state as keyof typeof workflowContract.statePositions] ?? 0
}

export function gateState(index: number, current: number): GateStatus {
  return current === gates.length || index < current ? 'complete' : index === current ? 'current' : 'waiting'
}
