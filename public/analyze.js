import { API, state } from './state.js';
import { escapeHtml, formatDuration, formatTime } from './utils.js';
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
  const messages = chatHistory.map((msg, idx) => {
    if (msg.role === 'user') {
      return `<div class="chat-message chat-user"><div class="chat-bubble chat-bubble-user">${escapeHtml(msg.content)}</div></div>`;
    }
    const userQuery = idx > 0 && chatHistory[idx - 1].role === 'user' ? chatHistory[idx - 1].content : '';
    const evidenceBtn = userQuery
      ? `<button class="btn-evidence" data-query="${escapeHtml(userQuery)}">&#9654; 근거 영상 보기</button>`
      : '';
    return `<div class="chat-message chat-assistant"><div class="chat-bubble chat-bubble-assistant markdown-body">${renderMarkdown(msg.content)}</div>${evidenceBtn}</div>`;
  });

  const lastMsg = chatHistory[chatHistory.length - 1];
  if (lastMsg && lastMsg.role === 'user') {
    messages.push('<div class="chat-message chat-assistant"><div class="chat-bubble chat-bubble-assistant"><span class="typing-dots"><span>.</span><span>.</span><span>.</span></span></div></div>');
  }

  analyzeResults.innerHTML = messages.join('');
  analyzeResults.scrollTop = analyzeResults.scrollHeight;

  analyzeResults.querySelectorAll('.btn-evidence').forEach((btn) => {
    btn.addEventListener('click', () => showEvidence(btn.dataset.query));
  });
}

async function showEvidence(query) {
  if (!state.currentProject || !state.selectedAnalyzeVideo) return;

  const modal = document.getElementById('modal-video-preview');
  const title = document.getElementById('modal-video-title');
  const body = document.getElementById('modal-video-body');

  title.textContent = '근거 영상 클립';
  body.innerHTML = '<div class="loading"><span class="spinner"></span>관련 클립 검색 중...</div>';
  modal.classList.remove('hidden');

  try {
    const formData = new FormData();
    formData.append('indexId', state.currentProject.id);
    formData.append('query', query);
    formData.append('searchOptions', JSON.stringify(['visual', 'audio', 'transcription']));

    const res = await apiFetch(`${API}/api/search`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('검색 실패');
    const data = await res.json();

    const videoId = state.selectedAnalyzeVideo.id;
    const clips = (data.clips || []).filter((c) => c.videoId === videoId).slice(0, 5);

    if (!clips.length) {
      body.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;padding:16px">관련 클립을 찾지 못했습니다.</p>';
      return;
    }

    body.innerHTML = clips.map((clip, i) => `
      <div class="evidence-clip" data-idx="${i}">
        <span class="clip-time">${formatTime(clip.start)} – ${formatTime(clip.end)}</span>
        ${clip.transcription ? `<span class="clip-transcription">${escapeHtml(clip.transcription)}</span>` : ''}
      </div>
    `).join('');

    body.querySelectorAll('.evidence-clip').forEach((el) => {
      el.addEventListener('click', () => {
        const clip = clips[parseInt(el.dataset.idx)];
        playEvidenceClip(clip);
      });
    });
  } catch (err) {
    body.innerHTML = `<p style="color:#6b7280;font-size:0.85rem;padding:16px">오류: ${escapeHtml(err.message)}</p>`;
  }
}

function playEvidenceClip(clip) {
  const body = document.getElementById('modal-video-body');
  if (!clip.hlsUrl) {
    body.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;padding:16px">재생 가능한 스트림이 없습니다.</p>';
    return;
  }

  const videoEl = document.createElement('video');
  videoEl.controls = true;
  videoEl.autoplay = true;
  videoEl.style.width = '100%';
  videoEl.style.borderRadius = '8px';
  body.innerHTML = '';
  body.appendChild(videoEl);

  const startTime = clip.start || 0;
  const endTime = clip.end;

  function onTimeUpdate() {
    if (endTime != null && videoEl.currentTime >= endTime) {
      videoEl.pause();
      videoEl.removeEventListener('timeupdate', onTimeUpdate);
    }
  }
  videoEl.addEventListener('timeupdate', onTimeUpdate);

  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(clip.hlsUrl);
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      videoEl.currentTime = startTime;
      videoEl.play();
    });
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = clip.hlsUrl;
    videoEl.addEventListener('loadedmetadata', () => {
      videoEl.currentTime = startTime;
      videoEl.play();
    });
  }
}
