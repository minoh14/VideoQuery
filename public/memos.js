import { API, state } from './state.js';
import { escapeHtml, openModal, closeModals } from './utils.js';
import { apiFetch } from './auth.js';

let editingVideoId = null;
let editingTags = [];

const tagChipsEdit = document.getElementById('tag-chips-edit');
const tagInput = document.getElementById('input-new-tag');
const memoInput = document.getElementById('input-video-memo');
const memoCharCount = document.getElementById('memo-char-count');

export async function fetchBatchMeta(videoIds) {
  if (!state.currentProject || !videoIds.length) return {};
  const ids = videoIds.join(',');
  const res = await apiFetch(`${API}/api/videos/meta/batch?indexId=${state.currentProject.id}&ids=${encodeURIComponent(ids)}`);
  if (!res.ok) return {};
  return res.json();
}

export function renderTagChips(tags) {
  if (!tags || !tags.length) return '';
  const visible = tags.slice(0, 3);
  const extra = tags.length > 3 ? `<span class="tag-chip tag-chip-more">+${tags.length - 3}</span>` : '';
  return `<div class="video-tags">${visible.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}${extra}</div>`;
}

export function openMetaEditor(video) {
  editingVideoId = video.id;
  const cached = state.videoMetas[video.id];
  editingTags = cached ? [...cached.tags] : [];
  memoInput.value = cached ? cached.memo : '';
  memoCharCount.textContent = memoInput.value.length;
  renderEditTags();
  tagInput.value = '';
  openModal('modal-video-meta');
}

function renderEditTags() {
  tagChipsEdit.innerHTML = editingTags.map((t, i) =>
    `<span class="tag-chip tag-chip-editable">${escapeHtml(t)}<button class="tag-chip-remove" data-idx="${i}">&times;</button></span>`
  ).join('');
  tagChipsEdit.querySelectorAll('.tag-chip-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingTags.splice(parseInt(btn.dataset.idx), 1);
      renderEditTags();
    });
  });
}

function addTag(text) {
  const tag = text.trim().slice(0, 30);
  if (!tag) return;
  if (editingTags.length >= 10) return;
  if (editingTags.includes(tag)) return;
  editingTags.push(tag);
  renderEditTags();
}

tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag(tagInput.value.replace(',', ''));
    tagInput.value = '';
  }
});

memoInput.addEventListener('input', () => {
  memoCharCount.textContent = memoInput.value.length;
});

document.getElementById('btn-save-meta').addEventListener('click', async () => {
  if (!editingVideoId || !state.currentProject) return;
  const btn = document.getElementById('btn-save-meta');
  btn.disabled = true;
  try {
    const res = await apiFetch(`${API}/api/videos/${editingVideoId}/meta?indexId=${state.currentProject.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: editingTags, memo: memoInput.value }),
    });
    if (!res.ok) throw new Error('저장 실패');
    const data = await res.json();
    state.videoMetas[editingVideoId] = data;
    closeModals();
    import('./videos.js').then(({ loadVideos }) => loadVideos());
  } catch {
    // silent
  } finally {
    btn.disabled = false;
  }
});
