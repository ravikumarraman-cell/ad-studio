import { FormEvent } from 'react'
import { api, Membership, newIdempotencyKey } from './adx-api-client'

type Props = { workspace?: Membership; onClose: () => void; onCreated: () => void; onError: (message: string) => void; error: string }

export function CreateCaseModal({ workspace, onClose, onCreated, onError, error }: Props) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await api(`/v1/workspaces/${workspace?.workspaceId}/change-cases`, { method: 'POST', headers: { 'idempotency-key': newIdempotencyKey() }, body: JSON.stringify({ title: form.get('title'), riskTier: form.get('riskTier') }) })
      onCreated()
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Could not create Change Case') }
  }
  return <div className="adx-modal-backdrop"><form className="adx-modal" onSubmit={submit}><div><p className="adx-eyebrow">NEW CHANGE CASE</p><h2>Describe the work to govern</h2><p>ADX will create a durable Change Case in your selected workspace.</p></div><label>Change title<input name="title" required maxLength={240} placeholder="What outcome needs review?" aria-describedby="case-title-help" /><small id="case-title-help">Use a short, outcome-focused description.</small></label><label>Initial review level<select name="riskTier" defaultValue="R1"><option value="R0">R0 - minimal impact</option><option value="R1">R1 - standard review</option><option value="R2">R2 - elevated review</option><option value="R3">R3 - high assurance</option><option value="R4">R4 - highest assurance</option></select><small>Start with the best fit. ADX guides the appropriate gates next.</small></label>{error && <p className="adx-error">{error}</p>}<div><button type="button" className="adx-secondary" onClick={onClose}>Cancel</button><button className="adx-primary">Create Change Case</button></div></form></div>
}
