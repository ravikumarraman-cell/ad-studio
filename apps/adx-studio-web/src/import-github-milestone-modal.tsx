import { useState } from 'react'
import { importPrivateGitHubMilestone, importPublicGitHubMilestone, listPrivateGitHubMilestones, listPublicGitHubMilestones, Membership, PublicGitHubMilestone } from './adx-api-client'

export function ImportGitHubMilestoneModal({ workspace, onClose, onDone }: { workspace?: Membership; onClose: () => void; onDone: () => void }) {
  const [repositoryAccess, setRepositoryAccess] = useState<'public' | 'private'>('public')
  const [owner, setOwner] = useState('')
  const [repository, setRepository] = useState('')
  const [milestones, setMilestones] = useState<PublicGitHubMilestone[]>([])
  const [milestone, setMilestone] = useState('')
  const [featureOwner, setFeatureOwner] = useState('Product Operations')
  const [targetRepository, setTargetRepository] = useState('')
  const [riskTier, setRiskTier] = useState('R2')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const canLookup = Boolean(workspace && owner.trim() && repository.trim())
  const canImport = Boolean(milestone && featureOwner.trim() && targetRepository.trim())

  const lookup = async () => {
    if (!canLookup || !workspace) return
    setLoading(true)
    setMessage(`Loading ${repositoryAccess} GitHub milestones…`)
    setMilestones([])
    setMilestone('')
    try {
      const response = repositoryAccess === 'private'
        ? await listPrivateGitHubMilestones(workspace.workspaceId, owner.trim(), repository.trim())
        : await listPublicGitHubMilestones(workspace.workspaceId, owner.trim(), repository.trim())
      setMilestones(response.milestones)
      setMessage(response.milestones.length
        ? 'Choose a milestone, then set where the imported features should be delivered.'
        : `This ${repositoryAccess} repository has no open milestones.`)
    } catch (error) {
      setMessage(describeMilestoneImportError(error, workspace, repositoryAccess, 'lookup'))
    } finally {
      setLoading(false)
    }
  }

  const importMilestone = async () => {
    if (!workspace || !canImport) return
    setLoading(true)
    setMessage('Retaining the milestone context and creating one feature per GitHub issue…')
    try {
      const input = { owner: owner.trim(), repository: repository.trim(), milestone: Number(milestone), featureOwner: featureOwner.trim(), targetRepository: targetRepository.trim(), riskTier }
      const response = repositoryAccess === 'private'
        ? await importPrivateGitHubMilestone(workspace.workspaceId, input)
        : await importPublicGitHubMilestone(workspace.workspaceId, input)
      const imported = response.results.filter((result) => result.status === 'IMPORTED').length
      const clarification = response.results.filter((result) => result.status === 'REQUIRES_CLARIFICATION').length
      const failed = response.results.length - imported - clarification
      setMessage(`Created ${imported} feature${imported === 1 ? '' : 's'}${clarification ? `; ${clarification} need${clarification === 1 ? 's' : ''} clarification` : ''}${failed ? `; ${failed} failed` : ''}.`)
      if (imported || clarification) onDone()
    } catch (error) {
      setMessage(describeMilestoneImportError(error, workspace, repositoryAccess, 'import'))
    } finally {
      setLoading(false)
    }
  }

  return <div className="adx-modal-backdrop adx-import-backdrop" role="presentation">
    <section className="adx-modal adx-import" role="dialog" aria-modal="true" aria-labelledby="github-milestone-title" aria-describedby="github-milestone-description">
      <header className="adx-import-header">
        <div>
          <p className="adx-eyebrow">GITHUB MILESTONE</p>
          <h2 id="github-milestone-title">Import milestone issues</h2>
          <p id="github-milestone-description">Turn the open issues in one GitHub milestone into governed ADX features. Your GitHub credential never enters this browser.</p>
        </div>
        <button type="button" className="adx-import-close" onClick={onClose} aria-label="Close milestone import">×</button>
      </header>

      <div className="adx-import-progress" aria-label={`Step ${milestones.length ? '2' : '1'} of 2`}>
        <span className="is-active"><b>1</b> Choose source</span>
        <span className={milestones.length ? 'is-active' : ''}><b>2</b> Set delivery context</span>
      </div>

      <div className="adx-import-body">
        <section className="adx-import-section" aria-labelledby="source-heading">
          <div className="adx-import-section-heading"><div><p className="adx-section-kicker">STEP 1</p><h3 id="source-heading">Find an open milestone</h3></div><p>Start with the repository that owns the issues.</p></div>
          <div className="adx-import-fields adx-import-source-fields">
            <label>Repository access<select value={repositoryAccess} onChange={(event) => { setRepositoryAccess(event.target.value as 'public' | 'private'); setMilestones([]); setMilestone(''); setMessage('') }}><option value="public">Public repository</option><option value="private">Private repository</option></select></label>
            <label>GitHub owner<input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="e.g. optum-eeps" autoComplete="off" /></label>
            <label>Repository<input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="e.g. cloud-asset-inventory" autoComplete="off" /></label>
          </div>
          {repositoryAccess === 'private' && <p className="adx-import-note">Private repositories require server-managed, read-only GitHub access. No browser credential is used.</p>}
          <button type="button" className="adx-secondary adx-import-lookup" disabled={loading || !canLookup} onClick={lookup}>{loading ? 'Finding milestones…' : 'Find open milestones'}</button>
        </section>

        {milestones.length > 0 && <section className="adx-import-section adx-import-delivery" aria-labelledby="delivery-heading">
          <div className="adx-import-section-heading"><div><p className="adx-section-kicker">STEP 2</p><h3 id="delivery-heading">Create delivery-ready features</h3></div><p>Choose the milestone and give every imported feature its shared delivery context.</p></div>
          <div className="adx-import-fields">
            <label className="adx-import-wide">Milestone<select value={milestone} onChange={(event) => setMilestone(event.target.value)}><option value="">Choose a milestone</option>{milestones.map((item) => <option key={item.number} value={item.number}>#{item.number} · {item.title} ({item.openIssues} open issues)</option>)}</select></label>
            <label>ADX feature owner<input value={featureOwner} onChange={(event) => setFeatureOwner(event.target.value)} /></label>
            <label>Target repository<input value={targetRepository} onChange={(event) => setTargetRepository(event.target.value)} placeholder="e.g. health-x" /></label>
            <label>Initial risk tier<select value={riskTier} onChange={(event) => setRiskTier(event.target.value)}>{['R0', 'R1', 'R2', 'R3', 'R4'].map((value) => <option key={value}>{value}</option>)}</select></label>
          </div>
        </section>}
        {message && <p className="adx-import-status" role="status">{message}</p>}
      </div>

      <footer className="adx-import-actions">
        <p>{milestones.length ? (canImport ? 'Ready to import this milestone.' : 'Complete the delivery context to continue.') : 'Enter a GitHub owner and repository to continue.'}</p>
        <div><button type="button" className="adx-secondary" disabled={loading} onClick={onClose}>Cancel</button><button type="button" className="adx-primary" disabled={loading || !canImport} onClick={importMilestone}>{loading ? 'Importing…' : 'Import milestone issues'}</button></div>
      </footer>
    </section>
  </div>
}

function describeMilestoneImportError(error: unknown, workspace: Membership | undefined, repositoryAccess: 'public' | 'private', phase: 'lookup' | 'import') {
  const fallback = phase === 'lookup' ? 'GitHub milestones could not be loaded.' : 'The milestone could not be imported.'
  if (!(error instanceof Error)) return fallback
  const code = (error as { code?: string }).code
  if (code !== 'CAPABILITY_MISSING') return error.message || fallback
  const roles = workspace?.roles?.length ? workspace.roles.join(', ') : 'unknown'
  const requiredCapability = phase === 'import' ? 'workspace.manage' : 'workspace.read'
  return `Your current workspace role (${roles}) does not include ${requiredCapability}, which is required to ${phase === 'lookup' ? 'load' : 'import'} ${repositoryAccess} GitHub milestones. If you were recently granted a new role, sign out and back in to refresh your session.`
}
