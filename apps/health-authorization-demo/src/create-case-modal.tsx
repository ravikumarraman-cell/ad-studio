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
  return <div className="adx-modal-backdrop"><form className="adx-modal" onSubmit={submit}><div><p className="adx-eyebrow">NEW CHANGE CASE</p><h2>Start with real governed work</h2><p>This creates a durable Change Case in your selected ADX workspace.</p></div><label>Title<input name="title" required maxLength={240} placeholder="Describe the change" /></label><label>Risk tier<select name="riskTier" defaultValue="R1"><option>R0</option><option>R1</option><option>R2</option><option>R3</option><option>R4</option></select></label>{error && <p className="adx-error">{error}</p>}<div><button type="button" className="adx-secondary" onClick={onClose}>Cancel</button><button className="adx-primary">Create Change Case</button></div></form></div>
}
