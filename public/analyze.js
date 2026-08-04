import { API, state } from './state.js';
import { escapeHtml, formatDuration } from './utils.js';
import { apiFetch } from './auth.js';

const analyzeInput = document.getElementById('analyze-input');
const analyzeResults = document.getElementById('analyze-results');

let chatHistory = [];

function getChatStorageKey() {
  if (!state.currentProject || !state.selectedAnalyzeVideo) return null;
  return `videoquery_chat_${state.currentProject.id}_${state.selectedAnalyzeVideo.id}`;
}

function saveChat() {
  const key = getChatStorageKey();
  if (!key) return;
  if (chatHistory.length === 0) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, JSON.stringify(chatHistory));
  }
}

function loadChat() {
  const key = getChatStorageKey();
  if (!key) return [];
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

document.getElementById('btn-export-chat').addEventListener('click', exportChat);
document.getElementById('btn-reset-chat').addEventListener('click', () => {
  if (chatHistory.length === 0) return;
  resetChat();
});

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
    saveChat();
  }
  state.selectedAnalyzeVideo = video;
  chatHistory = loadChat();
  if (chatHistory.length > 0) {
    renderChat();
  } else {
    analyzeResults.innerHTML = '<p class="placeholder-text">아래의 입력창에서 영상에 대해 질문하세요.</p>';
  }
  updateAnalyzeIndicator();
}

export function resetChat() {
  chatHistory = [];
  saveChat();
  const message = state.selectedAnalyzeVideo
    ? '아래의 입력창에서 영상에 대해 질문하세요.'
    : '사이드바에서 영상을 선택한 뒤 질문하세요.';
  analyzeResults.innerHTML = `<p class="placeholder-text">${message}</p>`;
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
    saveChat();
    renderChat();
  } catch (err) {
    if (err.name === 'AbortError') return;
    chatHistory.push({ role: 'assistant', content: `오류: ${err.message}` });
    saveChat();
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

function renderMarkdown(text) {
  const escaped = escapeHtml(text);
  const lines = escaped.split('\n');
  const result = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { result.push('</ul>'); inList = false; }
      const level = headingMatch[1].length;
      result.push(`<h${level + 2}>${headingMatch[2]}</h${level + 2}>`);
      continue;
    }

    const listMatch = line.match(/^[\-\*]\s+(.+)$/);
    if (listMatch) {
      if (!inList) { result.push('<ul>'); inList = true; }
      result.push(`<li>${applyInline(listMatch[1])}</li>`);
      continue;
    }

    const numListMatch = line.match(/^\d+\.\s+(.+)$/);
    if (numListMatch) {
      if (!inList) { result.push('<ul>'); inList = true; }
      result.push(`<li>${applyInline(numListMatch[1])}</li>`);
      continue;
    }

    if (inList) { result.push('</ul>'); inList = false; }

    if (line.trim() === '') {
      result.push('<br>');
    } else {
      result.push(`<p>${applyInline(line)}</p>`);
    }
  }
  if (inList) result.push('</ul>');
  return result.join('');
}

function applyInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function renderChat() {
  const messages = chatHistory.map((msg) => {
    if (msg.role === 'user') {
      return `<div class="chat-message chat-user"><div class="chat-bubble chat-bubble-user">${escapeHtml(msg.content)}</div></div>`;
    }
    return `<div class="chat-message chat-assistant"><div class="chat-bubble chat-bubble-assistant markdown-body">${renderMarkdown(msg.content)}</div></div>`;
  });

  const lastMsg = chatHistory[chatHistory.length - 1];
  if (lastMsg && lastMsg.role === 'user') {
    messages.push('<div class="chat-message chat-assistant"><div class="chat-bubble chat-bubble-assistant"><span class="typing-dots"><span>.</span><span>.</span><span>.</span></span></div></div>');
  }

  analyzeResults.innerHTML = messages.join('');
  analyzeResults.scrollTop = analyzeResults.scrollHeight;
}
