import { ChangeEvent, useState } from 'react'
import { importFeatures, Membership } from './adx-api-client'
import { ImportRow, parseFeatureCsv } from './feature-import'

export function ImportFeaturesModal({ workspace, onClose, onDone }: { workspace?: Membership; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<ImportRow[]>([]); const [message, setMessage] = useState(''); const [importId, setImportId] = useState(() => crypto.randomUUID()); const valid = rows.filter((row) => row.feature && !row.errors.length); const canSubmit = Boolean(workspace && valid.length)
  const upload = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; setImportId(crypto.randomUUID()); setMessage(''); setRows(parseFeatureCsv(await file.text())) }
  const confirm = async () => {
    if (!workspace) { setMessage('No ADX workspace is assigned to your signed-in identity. Ask an administrator to provision workspace access, then sign out and sign in again.'); return }
    if (!valid.length) return
    setMessage('Submitting the import manifest…')
    try {
      const response = await importFeatures(workspace.workspaceId, importId, valid.map((row) => row.feature!)); const imported = response.results.filter((result) => result.status === 'IMPORTED').length; const clarification = response.results.filter((result) => result.status === 'REQUIRES_CLARIFICATION').length; const failed = response.results.filter((result) => result.status === 'FAILED').length
      setMessage(`Import ${response.importId}: ${imported} ready for story breakdown${clarification ? `, ${clarification} need clarification` : ''}${failed ? `, ${failed} failed` : ''}. Re-submit this file to safely resume failed rows.`)
      if (!failed) onDone()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed.') }
  }
  return <div className="adx-modal-backdrop"><section className="adx-modal adx-import"><div><p className="adx-eyebrow">IMPORT FEATURE FILE</p><h2>Preview before creating work</h2><p>CSV only. The server creates and classifies each accepted feature with deterministic idempotency, so retrying this import will not create duplicate Change Cases.</p></div><label>Select CSV<input type="file" accept=".csv,text/csv" onChange={upload} /></label>{rows.length > 0 && <div className="adx-import-preview"><strong>{valid.length} valid of {rows.length} rows</strong>{rows.map((row) => <p key={row.row} className={row.errors.length ? 'adx-error' : ''}>Row {row.row}: {row.errors.length ? row.errors.join('; ') : row.feature?.title}</p>)}</div>}{!workspace && <p className="adx-error">No ADX workspace is assigned to your signed-in identity.</p>}{message && <p>{message}</p>}<div><button className="adx-secondary" onClick={onClose}>Cancel</button><button className="adx-primary" disabled={!canSubmit} onClick={confirm}>Create {valid.length} Change Cases</button></div></section></div>
}
