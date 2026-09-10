import { escapeHtml } from './review-page-utils.mjs';

export function renderPanel({ className, kicker, title, body, content = '', footer = '' }) {
  const classes = ['panel'];
  if (className) classes.push(className);
  return `<section class="${classes.join(' ')}"><p class="panel-label">${escapeHtml(kicker)}</p><h2>${escapeHtml(title)}</h2><p>${body}</p>${content}${footer}</section>`;
}

export function renderEvidenceRow(item, index) {
  const passed = item.status === 'PASS';
  const artifacts = Array.isArray(item.artifacts) ? item.artifacts : [];
  return `<article class="evidence-row ${passed ? 'passed' : 'failed'}"><div class="evidence-marker" aria-hidden="true">${passed ? 'PASS' : 'FAIL'}</div><div class="evidence-summary"><div class="evidence-head"><strong>Verification run ${index}</strong><span class="status-chip ${passed ? 'good' : 'bad'}">${escapeHtml(item.status)}</span></div><p>${escapeHtml(item.verifierId)} <span aria-hidden="true">/</span> ${escapeHtml(item.verifierVersion)} <span aria-hidden="true">/</span> ${artifacts.length} retained artifact${artifacts.length === 1 ? '' : 's'}</p></div><details><summary>Inspect provenance</summary><dl><dt>Candidate</dt><dd><code title="${escapeHtml(item.candidateDigest)}">${escapeHtml(item.candidateDigest)}</code></dd><dt>Evidence</dt><dd><code title="${escapeHtml(item.evidenceDigest)}">${escapeHtml(item.evidenceDigest)}</code></dd><dt>Runtime</dt><dd><code title="${escapeHtml(item.runtimeImageDigest)}">${escapeHtml(item.runtimeImageDigest)}</code></dd><dt>Configuration</dt><dd><code title="${escapeHtml(item.configDigest)}">${escapeHtml(item.configDigest)}</code></dd><dt>Command</dt><dd><code title="${escapeHtml(item.commandDigest)}">${escapeHtml(item.commandDigest)}</code></dd></dl>${artifacts.length ? `<ul class="artifacts">${artifacts.map((artifact) => `<li><code>${escapeHtml(artifact.digest)}</code><span>${escapeHtml(artifact.mediaType)} · ${escapeHtml(artifact.bytes)} bytes</span></li>`).join('')}</ul>` : ''}</details></article>`;
}

export function renderEvidenceList(items, { emptyMessage }) {
  return `<div class="evidence-list">${items.length ? items.map((item, index) => renderEvidenceRow(item, items.length - index)).join('') : `<p class="empty-state">${escapeHtml(emptyMessage)}</p>`}</div>`;
}