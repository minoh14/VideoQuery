import { API, state } from './state.js';
import { escapeHtml, formatDuration } from './utils.js';

const analyzeInput = document.getElementById('analyze-input');
const analyzeResults = document.getElementById('analyze-results');

export function selectVideoForAnalysis(video) {
  state.selectedAnalyzeVideo = video;
  updateAnalyzeIndicator();
}

export function updateAnalyzeIndicator() {
  const thumbEl = document.getElementById('analyze-thumb');
  const nameEl = document.getElementById('analyze-video-name');
  if (state.selectedAnalyzeVideo && state.selectedAnalyzeVideo.thumbnailUrl) {
    thumbEl.innerHTML = `<img src="${state.selectedAnalyzeVideo.thumbnailUrl}" alt="">`;
  } else {
    thumbEl.innerHTML = '<div class="analyze-thumb-placeholder"></div>';
  }
  if (state.selectedAnalyzeVideo) {
    const durationHtml = state.selectedAnalyzeVideo.duration
      ? `<span class="video-duration">${formatDuration(state.selectedAnalyzeVideo.duration)}</span>`
      : '';
    nameEl.innerHTML = `${escapeHtml(state.selectedAnalyzeVideo.filename || '제목 없음')} ${durationHtml}`;
    nameEl.style.color = '';
  } else {
    nameEl.textContent = '선택된 파일이 없습니다';
    nameEl.style.color = '#9ca3af';
  }
  const hasSelection = !!state.selectedAnalyzeVideo;
  analyzeInput.disabled = !hasSelection;
  analyzeInput.placeholder = hasSelection ? '영상에 대해 질문하세요...' : '사이드바에서 영상을 선택하세요...';
  document.getElementById('btn-analyze').disabled = !hasSelection;
}

export async function executeAnalyze() {
  const query = analyzeInput.value.trim();
  if (!query || !state.currentProject || !state.selectedAnalyzeVideo) return;
  const assetId = state.selectedAnalyzeVideo.assetId;

  if (state.analyzeController) state.analyzeController.abort();
  state.analyzeController = new AbortController();
  const signal = state.analyzeController.signal;

  analyzeResults.innerHTML = '<div class="loading"><span class="spinner"></span>분석 중...</div>';

  try {
    const res = await fetch(`${API}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId, prompt: query }),
      signal,
    });
    if (!res.ok) throw new Error('분석 실패');
    const data = await res.json();
    if (signal.aborted) return;
    renderAnalyzeResult(data.text);
  } catch (err) {
    if (err.name === 'AbortError') return;
    analyzeResults.innerHTML = `<p class="placeholder-text">오류: ${escapeHtml(err.message)}</p>`;
  }
}

function renderAnalyzeResult(text) {
  if (!text) {
    analyzeResults.innerHTML = '<p class="placeholder-text">분석 결과가 없습니다.</p>';
    return;
  }
  analyzeResults.innerHTML = `<div class="analyze-result">${escapeHtml(text.trim())}</div>`;
}
