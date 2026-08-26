import { FormEvent, useState } from 'react'
import { ApiError, cancelChangeCase, ChangeCase, Membership } from './adx-api-client'

type Mode = 'selected' | 'all'
type Props = { workspace?: Membership; selected?: ChangeCase; changeCases: ChangeCase[]; mode: Mode; onClose: () => void; onCompleted: () => void }

const canCancel = (changeCase: ChangeCase) => !['CANCELLED', 'OUTCOME_RECORDED'].includes(changeCase.state)

export function CancelChangeCasesModal({ workspace, selected, changeCases, mode, onClose, onCompleted }: Props) {
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const targets = mode === 'all' ? changeCases.filter(canCancel) : selected && canCancel(selected) ? [selected] : []
  const phrase = mode === 'all' ? 'CLEAR' : 'DELETE'
  const title = mode === 'all' ? 'Clear open Change Cases?' : 'Delete this Change Case?'
  const action = mode === 'all' ? `Clear ${targets.length} open cases` : 'Delete Change Case'

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!workspace || confirmation !== phrase || !targets.length) return
    setSubmitting(true)
    setMessage('')
    const failures: string[] = []
    for (const changeCase of targets) {
      try {
        await cancelChangeCase(workspace.workspaceId, changeCase)
      } catch (error) {
        if ((error as ApiError).status === 401) {
          setSubmitting(false)
          setMessage('Your session has expired. No Change Cases were cleared. Sign in again to continue.')
          return
        }
        failures.push(`${changeCase.title}: ${error instanceof Error ? error.message : 'Could not cancel this Change Case.'}`)
      }
    }
    setSubmitting(false)
    if (failures.length) {
      setMessage(failures.join(' '))
      return
    }
    onCompleted()
  }

  const authenticationRequired = message.startsWith('Your session has expired.')

  return <div className="adx-modal-backdrop"><form className="adx-modal adx-cancel-modal" onSubmit={submit}><div><p className="adx-eyebrow">WORKSPACE CLEANUP</p><h2>{title}</h2><p>{mode === 'all' ? 'This removes all open Change Cases from the active work list.' : 'This removes the selected Change Case from the active work list.'} ADX records a signed cancellation event and retains the original history for audit.</p></div><p className="adx-cancel-summary"><strong>{targets.length}</strong> {targets.length === 1 ? 'Change Case will be cancelled.' : 'Change Cases will be cancelled.'}</p><label>Type <strong>{phrase}</strong> to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value.toUpperCase())} autoComplete="off" autoFocus /></label>{message && <p className="adx-error">{message}</p>}<div className="adx-modal-actions">{authenticationRequired && <a className="adx-primary" href="/auth/login">Sign in again</a>}<button type="button" className="adx-secondary" disabled={submitting} onClick={onClose}>Keep cases</button><button className="adx-danger" disabled={submitting || authenticationRequired || confirmation !== phrase || !targets.length}>{submitting ? 'Cancelling…' : action}</button></div></form></div>
}
