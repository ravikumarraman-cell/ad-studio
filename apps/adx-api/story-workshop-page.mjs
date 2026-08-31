import { escapeHtml, htmlScriptConfig } from './review-page-utils.mjs';

const storyAuthoringStates = new Set(['RISK_REVIEW', 'AWAITING_STORY_APPROVAL', 'DESIGN_REVIEW']);

export function storyWorkshopPage(changeCase, governance, options) {
  return renderStoryWorkshopPage(changeCase, governance, options);
}

export function storyWorkshopPageWithModelSelector(changeCase, governance, options) {
  return renderStoryWorkshopPage(changeCase, governance, options);
}

function renderStoryWorkshopPage(changeCase, governance, options) {
  const isReady = storyAuthoringStates.has(changeCase.state);
  const canEdit = isReady && options.canAuthor;
  const activeStage = changeCase.state === 'RISK_REVIEW' ? 'draft' : changeCase.state === 'AWAITING_STORY_APPROVAL' ? 'review' : 'design';
  const stageCopy = {
    draft: {
      title: 'Draft stories, then send them to review',
      summary: 'Suggestions are a preview only. Nothing is persisted or approved until you submit the edited story set.',
      note: 'You can still refine the draft before submission.',
    },
    review: {
      title: 'Review the curated story set',
      summary: 'The retained draft is now ready for independent Gate B review.',
      note: 'Only a submitted story set can move forward.',
    },
    design: {
      title: 'Prepare the design review',
      summary: 'The approved story set is the source for design and delivery decisions.',
      note: 'Design follows approval, not the other way around.',
    },
  }[activeStage];

  const models = options.aiStatus.models ?? [];
  const templates = options.aiStatus.templates ?? [];
  const modelOptions = models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('');
  const templateOptions = templates
    .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.label)}${template.description ? ` - ${escapeHtml(template.description)}` : ''}</option>`)
    .join('');
  const config = htmlScriptConfig({
    storiesEndpoint: options.storiesEndpoint,
    storySuggestionsEndpoint: options.storySuggestionsEndpoint,
    expectedVersion: changeCase.projectionVersion,
    storyReviewUrl: options.storyReviewUrl,
  });

  const authoring = !isReady
    ? `
      <section class="card notice-card">
        <p class="eyebrow">NOT READY</p>
        <h2>Story shaping opens after risk classification</h2>
        <p>Complete intake and risk classification before creating the story set.</p>
      </section>
    `
    : !options.canAuthor
      ? `
        <section class="card notice-card">
          <p class="eyebrow">READ ONLY</p>
          <h2>You can view the breakdown, but cannot submit it</h2>
          <p>An authorized contributor must submit a revision for independent Gate B review.</p>
        </section>
      `
      : `
        <section class="workspace-grid">
          ${
            options.aiStatus.configured && models.length
              ? `
                <section class="card assistant">
                  <div class="section-heading">
                    <div>
                      <p class="eyebrow">OPTIONAL ASSISTANCE</p>
                      <h2>Generate a draft to curate</h2>
                    </div>
                    <p>Suggestions are never saved or approved automatically.</p>
                  </div>

                  <div class="pickers">
                    <label>
                      Approved model
                      <select id="story-ai-model">${modelOptions}</select>
                      <small>Provided by ${escapeHtml(options.aiStatus.providerLabel ?? 'the configured service')}.</small>
                    </label>
                    <label>
                      Reviewed Story specification
                      <select id="story-spec-template">
                        <option value="">Retained context only</option>
                        ${templateOptions}
                      </select>
                      <small>Only reviewed specifications are available.</small>
                    </label>
                  </div>

                  <button class="secondary full" id="suggest-stories" type="button">Generate suggestions</button>
                  <p id="suggestion-status" class="status" role="status" aria-live="polite"></p>
                  <p id="applied-spec" class="applied-spec" role="status" aria-live="polite" hidden></p>
                  <div id="suggestion-list" class="suggestion-list" aria-live="polite"></div>
                  <div id="suggestion-actions" class="actions" hidden>
                    <label><input id="select-all-stories" type="checkbox"> Select all stories</label>
                    <button id="accept-suggestions" class="button" type="button" disabled>Accept selected suggestions</button>
                  </div>
                </section>
              `
              : `
                <section class="card assistant unavailable">
                  <p class="eyebrow">OPTIONAL ASSISTANCE</p>
                  <h2>Suggestions are unavailable</h2>
                  <p>Manual authoring is available. An administrator can enable an approved server-side model; no browser key is used.</p>
                </section>
              `
          }

          <form id="story-workshop-form" class="card story-form" novalidate>
            <div class="section-heading">
              <div>
                <p class="eyebrow">STORY SET</p>
                <h2>Shape a reviewable story set</h2>
              </div>
              <p>Drafts stay editable until you explicitly submit them for independent Gate B review.</p>
            </div>

            <div id="story-list" aria-live="polite"></div>

            <template id="story-template">
              <article class="story-card">
                <div class="story-head">
                  <strong class="story-number"></strong>
                  <button class="remove" type="button">Remove story</button>
                </div>
                <label>
                  Story title
                  <input name="title" required placeholder="Describe the user outcome">
                </label>
                <label>
                  User need
                  <textarea name="narrative" required placeholder="As a ..., I want ..., so that ..."></textarea>
                </label>
                <fieldset>
                  <legend>Acceptance example</legend>
                  <label>Given<textarea name="given" required></textarea></label>
                  <label>When<textarea name="when" required></textarea></label>
                  <label>Then<textarea name="then" required></textarea></label>
                </fieldset>
              </article>
            </template>

            <div class="actions">
              <button class="secondary" id="add-story" type="button">Add story</button>
              <button class="button" type="submit">Submit stories for independent review</button>
            </div>
            <p id="workshop-status" class="status" role="status" aria-live="polite"></p>
          </form>

          <aside class="card workspace-rail">
            <div class="rail-card">
              <p class="eyebrow">WHY THIS MATTERS</p>
              <strong>Keep the story set reviewer-friendly.</strong>
              <p>The cleanest submissions are short, specific, and easy to compare. The reviewer should be able to scan each story and understand the outcome without hunting through prose.</p>
            </div>
            <div class="rail-card">
              <p class="eyebrow">QUALITY BAR</p>
              <ul>
                <li>One user outcome per story</li>
                <li>One clear user need</li>
                <li>Given / When / Then must be concrete</li>
                <li>Suggestions are optional, not authoritative</li>
              </ul>
            </div>
            <div class="rail-card subtle">
              <p class="eyebrow">NEXT STEP</p>
              <strong>${escapeHtml(stageCopy.note)}</strong>
            </div>
          </aside>
        </section>
      `;

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>ADX Story Breakdown - ${escapeHtml(changeCase.title)}</title>
      <style>${storyWorkshopStyles}</style>
    </head>
    <body>
      <main class="page">
        <header class="page-header">
          <div class="page-title">
            <a class="adx-home-link" href="${escapeHtml(options.homeUrl)}">&larr; Back to ADX home</a>
            <p class="eyebrow">CHANGE CASE / STORY BREAKDOWN</p>
            <h1>${escapeHtml(changeCase.title)}</h1>
            <p class="meta">${escapeHtml(changeCase.riskTier)} risk / ${escapeHtml(changeCase.state)} / Version ${escapeHtml(changeCase.projectionVersion)}</p>
          </div>
          <aside class="header-rail" aria-label="Story breakdown guidance">
            <ol class="progress" aria-label="Story breakdown stages">
              <li class="${activeStage === 'draft' ? 'active' : activeStage === 'review' || activeStage === 'design' ? 'complete' : ''}"${activeStage === 'draft' ? ' aria-current="step"' : ''}>
                <span>1</span>
                <strong>Draft</strong>
                <small>Shape the story set</small>
              </li>
              <li class="${activeStage === 'review' ? 'active' : activeStage === 'design' ? 'complete' : ''}"${activeStage === 'review' ? ' aria-current="step"' : ''}>
                <span>2</span>
                <strong>Review</strong>
                <small>Independent Gate B review</small>
              </li>
              <li class="${activeStage === 'design' ? 'active' : ''}"${activeStage === 'design' ? ' aria-current="step"' : ''}>
                <span>3</span>
                <strong>Design</strong>
                <small>Use the approved story set</small>
              </li>
            </ol>
            <section class="rail-card">
              <p class="eyebrow">FOCUS FOR THIS STEP</p>
              <strong>${escapeHtml(stageCopy.title)}</strong>
              <p>${escapeHtml(stageCopy.note)}</p>
            </section>
          </aside>
        </header>

        <section class="card context">
          <p class="eyebrow">CURRENT STEP</p>
          <div class="context-grid">
            <div>
              <h2>${escapeHtml(stageCopy.title)}</h2>
              <p>${escapeHtml(stageCopy.summary)}</p>
            </div>
            <p class="context-note">${escapeHtml(stageCopy.note)}</p>
          </div>
        </section>

        ${authoring}
      </main>
      ${canEdit ? `<script>${storyWorkshopController(config)}</script>` : ''}
    </body>
  </html>`;
}

const storyWorkshopStyles = `
:root {
  color: #102b43;
  background: #f4f7fb;
  font: 16px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f4f7fb;
  color: #102b43;
}

main {
  max-width: 1280px;
  margin: 0 auto;
  padding: 28px 20px 64px;
}

.page {
  display: grid;
  gap: 14px;
}

.page-header {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(380px, 0.92fr);
  gap: 18px;
  align-items: start;
  padding: 32px 32px 32px;
}

.adx-home-link {
  color: #155b4d;
  font-weight: 750;
  text-decoration: none;
  white-space: nowrap;
}

.adx-home-link:hover {
  text-decoration: underline;
}

.adx-home-link:focus-visible,
button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: 3px solid #f6b73c;
  outline-offset: 3px;
}

.page-title h1,
.context h2,
.assistant h2,
.story-form h2,
.notice-card h2 {
  margin: 0;
  line-height: 1.08;
  letter-spacing: -0.04em;
}

.page-title h1 {
  font-size: clamp(1.95rem, 3vw, 3rem);
  max-width: 16ch;
}

.page-title {
  max-width: 900px;
}

.page-title .adx-home-link {
  display: inline-block;
  margin-bottom: 6px;
}

.header-rail {
  display: grid;
  gap: 8px;
  align-content: start;
}

.eyebrow {
  margin: 0 0 8px;
  color: #56718a;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.meta,
.section-heading > p,
.context p,
.assistant > p:not(.eyebrow),
.notice-card > p:not(.eyebrow),
.status,
.applied-spec,
.story-form > p,
.context-note {
  color: #52645f;
}

.meta {
  margin: 10px 0 0;
  font-size: 0.98rem;
}

.progress {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.progress li {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 8px;
  row-gap: 3px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #d5e0da;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(16 42 67 / 7%);
}

.progress li span {
  grid-row: span 2;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: #e6edf3;
  color: #2d4c63;
  font-size: 0.79rem;
  font-weight: 800;
}

.progress li strong,
.progress li small {
  display: block;
}

.progress li strong {
  color: #102b43;
}

.progress li small {
  color: #52645f;
  font-size: 0.76rem;
}

.progress li.complete {
  border-color: #a8d6b5;
  background: #f1fbf4;
}

.progress li.complete span {
  background: #dff3e6;
  color: #1a7a46;
}

.progress li.active {
  border: 2px solid #2a78c4;
  background: #edf7ff;
  box-shadow: 0 10px 24px rgb(42 120 196 / 10%);
}

.progress li.active span {
  background: #dcedfb;
  color: #165f9c;
}

.rail-card {
  padding: 12px 14px;
  border: 1px solid #d4e0da;
  border-radius: 18px;
  background: linear-gradient(180deg, #fff, #f7fbf8);
  box-shadow: 0 1px 2px rgb(16 42 67 / 7%);
}

.rail-card strong {
  display: block;
  margin-top: 2px;
  color: #102b43;
  line-height: 1.25;
}

.rail-card p {
  margin: 8px 0 0;
  color: #52645f;
  line-height: 1.55;
}

.rail-card ul {
  margin: 10px 0 0;
  padding-left: 18px;
  color: #52645f;
}

.rail-card li + li {
  margin-top: 6px;
}

.rail-card.subtle {
  background: #f4fbf8;
  border-color: #c8ddd2;
}

.card,
.notice-card,
.assistant,
.story-form {
  background: #fff;
  border: 1px solid #d5e0da;
  border-radius: 18px;
  box-shadow: 0 1px 2px rgb(16 42 67 / 7%);
}

.context,
.notice-card,
.assistant,
.story-form {
  padding: 20px;
}

.context-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(200px, 0.7fr);
  gap: 16px;
  align-items: start;
}

.context h2 {
  font-size: clamp(1.5rem, 2.4vw, 2.1rem);
}

.context p {
  margin: 10px 0 0;
  font-size: 1rem;
  line-height: 1.65;
}

.context-note {
  margin: 0;
  padding: 14px 16px;
  border-left: 4px solid #176b5a;
  border-radius: 12px;
  background: #f1fbf7;
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.84fr) minmax(0, 1.46fr) minmax(220px, 0.66fr);
  gap: 14px;
  align-items: start;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: start;
}

.section-heading > p {
  max-width: 360px;
  margin: 0;
}

.assistant.unavailable {
  color: #52645f;
}

.pickers {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin: 18px 0 16px;
}

label {
  display: grid;
  gap: 6px;
  color: #24473f;
  font-size: 0.92rem;
  font-weight: 700;
}

small {
  color: #647872;
  font-size: 0.8rem;
  font-weight: 500;
}

input,
textarea,
select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #8ea59d;
  border-radius: 12px;
  background: #fff;
  color: #17332f;
  font: inherit;
}

textarea {
  min-height: 72px;
  resize: vertical;
}

.button,
.secondary,
.remove {
  border-radius: 12px;
  cursor: pointer;
  font: inherit;
  font-weight: 750;
  padding: 10px 14px;
}

.button {
  border: 1px solid #176b5a;
  background: #176b5a;
  color: #fff;
}

.button:disabled {
  background: #9cb6ad;
  border-color: #9cb6ad;
  cursor: not-allowed;
}

.secondary {
  border: 1px solid #58847a;
  background: #fff;
  color: #174c41;
}

.full {
  width: 100%;
}

.status {
  min-height: 1.5rem;
  margin: 12px 0 0;
}

.status.error {
  color: #982f24;
}

.applied-spec {
  padding-left: 10px;
  border-left: 3px solid #c68827;
  color: #53421f;
}

.suggestion-list {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.suggestion {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  padding: 14px;
  border: 1px solid #b9cbc3;
  border-radius: 14px;
  background: #fff;
  cursor: pointer;
}

.suggestion:has(input:checked) {
  border-color: #176b5a;
  background: #f0f7f3;
}

.suggestion input,
.actions input {
  width: 18px;
  height: 18px;
  accent-color: #176b5a;
}

.suggestion strong,
.suggestion small {
  display: block;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.actions label {
  display: block;
}

.story-form {
  display: grid;
  gap: 14px;
}

.workspace-rail {
  display: grid;
  gap: 12px;
  position: sticky;
  top: 18px;
}

.story-card {
  margin: 16px 0;
  padding: 18px;
  border: 1px solid #b9cbc3;
  border-radius: 16px;
  background: #fff;
}

.story-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #d9e2dd;
}

.story-number {
  color: #176b5a;
}

.remove {
  border: 1px solid #b95a4d;
  background: #fff;
  color: #8b3026;
  padding: 6px 10px;
}

.story-card label {
  margin-top: 12px;
}

fieldset {
  margin: 20px 0 0;
  padding: 16px 0 0;
  border: 0;
  border-top: 1px solid #d9e2dd;
}

legend {
  color: #24473f;
  font-weight: 800;
}

@media (max-width: 980px) {
  .page-header,
  .workspace-grid,
  .context-grid {
    grid-template-columns: 1fr;
  }

  .progress {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  main {
    padding-inline: 16px;
  }

  .page-title .adx-home-link {
    margin-bottom: 10px;
  }

  .section-heading {
    display: block;
  }

  .pickers {
    grid-template-columns: 1fr;
  }

  .actions .button {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  * {
    scroll-behavior: auto;
    transition: none !important;
  }
}
`;

function storyWorkshopController(config) {
  return `(function(){const config=${config},form=document.getElementById('story-workshop-form'),storyList=document.getElementById('story-list'),template=document.getElementById('story-template'),status=document.getElementById('workshop-status');if(!form)return;const number=()=>storyList.querySelectorAll('.story-card').forEach((card,index)=>card.querySelector('.story-number').textContent='Story '+(index+1));const add=(story={})=>{storyList.append(template.content.cloneNode(true));const card=storyList.lastElementChild,scenario=story.scenarios?.[0]||{};for(const[name,value]of Object.entries({title:story.title||'',narrative:story.narrative||'',given:scenario.given||'',when:scenario.when||'',then:scenario.then||''}))card.querySelector('[name='+name+']').value=value;card.querySelector('.remove').onclick=()=>{card.remove();number()};number();return card};document.getElementById('add-story').onclick=()=>add();add();const suggest=document.getElementById('suggest-stories');if(suggest){const suggestionStatus=document.getElementById('suggestion-status'),suggestionList=document.getElementById('suggestion-list'),actions=document.getElementById('suggestion-actions'),accept=document.getElementById('accept-suggestions'),selectAll=document.getElementById('select-all-stories'),marker=document.getElementById('applied-spec');let suggestions=[];const sync=()=>{const boxes=[...suggestionList.querySelectorAll('input')],count=boxes.filter(box=>box.checked).length;selectAll.checked=Boolean(boxes.length)&&count===boxes.length;selectAll.indeterminate=count>0&&count<boxes.length;accept.disabled=!count;accept.textContent=count?'Accept selected suggestions ('+count+')':'Accept selected suggestions'};suggest.onclick=async()=>{suggest.disabled=true;suggest.textContent='Generating...';suggestionStatus.className='status';suggestionStatus.textContent='Preparing a draft. Nothing is being saved.';suggestionList.replaceChildren();actions.hidden=true;marker.hidden=true;try{const response=await fetch(config.storySuggestionsEndpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({model:document.getElementById('story-ai-model').value,templateId:document.getElementById('story-spec-template').value})}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error?.message||'Unable to generate suggestions.');suggestions=body.suggestions||[];const receiptTemplate=body.receipt?.template;marker.textContent=receiptTemplate?'Applied specification: '+receiptTemplate.id+' v'+receiptTemplate.version+' ('+receiptTemplate.digest+')':'Retained context only was used.';marker.hidden=false;suggestions.forEach((story,index)=>{const label=document.createElement('label'),box=document.createElement('input'),copy=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('small');label.className='suggestion';box.type='checkbox';box.value=index;box.setAttribute('aria-label','Select '+story.title);title.textContent=story.title;detail.textContent=story.narrative;copy.append(title,detail);label.append(box,copy);suggestionList.append(label)});if(suggestions.length){actions.hidden=false;sync();suggestionStatus.textContent=suggestions.length+' suggestions are ready to review.'}else suggestionStatus.textContent='No suggestions were returned. You can continue with manual authoring.'}catch(error){suggestionStatus.className='status error';suggestionStatus.textContent=error.message}finally{suggest.disabled=false;suggest.textContent='Generate suggestions'}};selectAll.onchange=()=>{suggestionList.querySelectorAll('input').forEach(box=>box.checked=selectAll.checked);sync()};suggestionList.onchange=sync;accept.onclick=()=>{const selected=[...suggestionList.querySelectorAll('input:checked')].map(box=>suggestions[box.value]);const cards=[...storyList.querySelectorAll('.story-card')];if(cards.length===1&&![...cards[0].querySelectorAll('[name]')].some(field=>field.value.trim()))cards[0].remove();selected.forEach(add);actions.hidden=true;suggestionStatus.textContent=selected.length+' suggestions added to the editable draft. Review and submit when ready.'}}form.onsubmit=async(event)=>{event.preventDefault();const stories=[...storyList.querySelectorAll('.story-card')].map((card,index)=>({key:'STORY-'+(index+1),title:card.querySelector('[name=title]').value.trim(),narrative:card.querySelector('[name=narrative]').value.trim(),scenarios:[{given:card.querySelector('[name=given]').value.trim(),when:card.querySelector('[name=when]').value.trim(),then:card.querySelector('[name=then]').value.trim()}]}));if(!stories.length||stories.some(story=>!story.title||!story.narrative||!story.scenarios[0].given||!story.scenarios[0].when||!story.scenarios[0].then)){status.className='status error';status.textContent='Each story needs a title, user need, and Given / When / Then example.';return}const button=form.querySelector('[type=submit]');button.disabled=true;button.textContent='Submitting...';try{const response=await fetch(config.storiesEndpoint,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({stories,expectedVersion:config.expectedVersion})}),body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error?.message||'Unable to submit the story set.');status.textContent='Stories submitted. Opening independent review...';window.setTimeout(()=>window.location.href=config.storyReviewUrl,350)}catch(error){status.className='status error';status.textContent=error.message;button.disabled=false;button.textContent='Submit stories for independent review'}}})()`;
}
