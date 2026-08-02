import { API, state } from './state.js';
import { escapeHtml, formatDuration } from './utils.js';
import { apiFetch } from './auth.js';

const analyzeInput = document.getElementById('analyze-input');
const analyzeResults = document.getElementById('analyze-results');

let chatHistory = [];

document.getElementById('btn-export-chat').addEventListener('click', exportChat);

function exportChat() {
  if (!chatHistory.length) return;
  const videoName = state.selectedAnalyzeVideo?.filename || '영상';
  const lines = [`# ${videoName} — 분석 대화\n`];
  chatHistory.forEach((msg) => {
    if (msg.role === 'user') {
      lines.push(`**Q:** ${msg.content}\n`);
    } else {
      lines.push(`**A:** ${msg.content}\n`);
    }
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${videoName}_분석.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function selectVideoForAnalysis(video) {
  if (state.selectedAnalyzeVideo && state.selectedAnalyzeVideo.id !== video.id) {
    resetChat();
  }
  state.selectedAnalyzeVideo = video;
  updateAnalyzeIndicator();
}

export function resetChat() {
  chatHistory = [];
  analyzeResults.innerHTML = '<p class="placeholder-text">사이드바에서 영상을 선택한 뒤 질문하세요.</p>';
}

export function updateAnalyzeIndicator() {
  const thumbEl = document.getElementById('analyze-thumb');
  const nameEl = document.getElementById('analyze-video-name');
  if (state.selectedAnalyzeVideo && state.selectedAnalyzeVideo.thumbnailUrl) {
    thumbEl.innerHTML = `<img src="${state.selectedAnalyzeVideo.thumbnailUrl}" alt="">`;
    thumbEl.style.cursor = 'pointer';
    thumbEl.onclick = () => {
      import('./videos.js').then(({ showVideoPreview }) => showVideoPreview(state.selectedAnalyzeVideo));
    };
  } else {
    thumbEl.innerHTML = '<div class="analyze-thumb-placeholder"></div>';
    thumbEl.style.cursor = '';
    thumbEl.onclick = null;
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

  chatHistory.push({ role: 'user', content: query });
  renderChat();
  analyzeInput.value = '';

  if (state.analyzeController) state.analyzeController.abort();
  state.analyzeController = new AbortController();
  const signal = state.analyzeController.signal;

  const prompt = buildPrompt();

  try {
    const res = await apiFetch(`${API}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId, prompt }),
      signal,
    });
    if (!res.ok) throw new Error('분석 실패');
    const data = await res.json();
    if (signal.aborted) return;
    const answer = (data.text || '').trim();
    chatHistory.push({ role: 'assistant', content: answer || '분석 결과가 없습니다.' });
    renderChat();
  } catch (err) {
    if (err.name === 'AbortError') return;
    chatHistory.push({ role: 'assistant', content: `오류: ${err.message}` });
    renderChat();
  }
}

function buildPrompt() {
  if (chatHistory.length <= 1) {
    return chatHistory[chatHistory.length - 1].content;
  }
  const lines = chatHistory.map((msg) => {
    if (msg.role === 'user') return `User: ${msg.content}`;
    return `Assistant: ${msg.content}`;
  });
  lines.push('Assistant:');
  return lines.join('\n');
}

function renderChat() {
  const messages = chatHistory.map((msg) => {
    if (msg.role === 'user') {
      return `<div class="chat-message chat-user"><div class="chat-bubble chat-bubble-user">${escapeHtml(msg.content)}</div></div>`;
    }
    return `<div class="chat-message chat-assistant"><div class="chat-bubble chat-bubble-assistant">${escapeHtml(msg.content)}</div></div>`;
  });

  const lastMsg = chatHistory[chatHistory.length - 1];
  if (lastMsg && lastMsg.role === 'user') {
    messages.push('<div class="chat-message chat-assistant"><div class="chat-bubble chat-bubble-assistant"><span class="typing-dots"><span>.</span><span>.</span><span>.</span></span></div></div>');
  }

  analyzeResults.innerHTML = messages.join('');
  analyzeResults.scrollTop = analyzeResults.scrollHeight;
}
