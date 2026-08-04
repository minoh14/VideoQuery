import { API, state } from './state.js';
import { escapeHtml, formatTime } from './utils.js';
import { closeVideoPreview, navigateToVideoPage } from './videos.js';
import { apiFetch } from './auth.js';
import { selectVideoForAnalysis, updateAnalyzeIndicator } from './analyze.js';

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const imageInput = document.getElementById('input-search-image');
const imageNameEl = document.getElementById('search-image-name');
const btnRemoveImage = document.getElementById('btn-remove-image');
const btnClearSearch = document.getElementById('btn-clear-search');
const historyDropdown = document.getElementById('search-history-dropdown');

const HISTORY_KEY_PREFIX = 'videoquery_search_history_';
const MAX_HISTORY = 20;

let searchImageFile = null;

function getHistoryKey() {
  return HISTORY_KEY_PREFIX + (state.currentProject?.id || 'global');
}

function getSearchHistory() {
  try {
    return JSON.parse(localStorage.getItem(getHistoryKey())) || [];
  } catch { return []; }
}

function saveSearchHistory(query) {
  if (!query) return;
  let history = getSearchHistory();
  history = history.filter((h) => h !== query);
  history.unshift(query);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(getHistoryKey(), JSON.stringify(history));
}

function showHistory() {
  const history = getSearchHistory();
  if (!history.length) { historyDropdown.classList.add('hidden'); return; }
  const filter = searchInput.value.trim().toLowerCase();
  const filtered = filter ? history.filter((h) => h.toLowerCase().includes(filter)) : history;
  if (!filtered.length) { historyDropdown.classList.add('hidden'); return; }
  historyDropdown.innerHTML = filtered.map((h) =>
    `<li class="search-history-item">${escapeHtml(h)}</li>`
  ).join('');
  historyDropdown.classList.remove('hidden');
  historyDropdown.querySelectorAll('.search-history-item').forEach((item) => {
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      searchInput.value = item.textContent;
      historyDropdown.classList.add('hidden');
      executeSearch();
    });
  });
}

searchInput.addEventListener('focus', showHistory);
searchInput.addEventListener('input', () => {
  showHistory();
  btnClearSearch.classList.toggle('hidden', !searchInput.value);
});
searchInput.addEventListener('blur', () => {
  setTimeout(() => historyDropdown.classList.add('hidden'), 150);
});

btnClearSearch.addEventListener('click', () => {
  searchInput.value = '';
  btnClearSearch.classList.add('hidden');
  searchResults.innerHTML = '<p class="placeholder-text">프로젝트 내 영상에서 장면을 검색합니다.</p>';
});

document.getElementById('btn-attach-image').addEventListener('click', () => imageInput.click());

imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  if (file) {
    searchImageFile = file;
    imageNameEl.textContent = file.name;
    btnRemoveImage.classList.remove('hidden');
  }
});

btnRemoveImage.addEventListener('click', () => {
  searchImageFile = null;
  imageInput.value = '';
  imageNameEl.textContent = '';
  btnRemoveImage.classList.add('hidden');
});

function getSearchOptions() {
  const checked = document.querySelectorAll('.search-options input:checked');
  const options = Array.from(checked).map((el) => el.value);
  return options.length > 0 ? options : ['visual'];
}

export async function executeSearch() {
  const query = searchInput.value.trim();
  if (!query && !searchImageFile) return;
  if (!state.currentProject) return;
  historyDropdown.classList.add('hidden');
  btnClearSearch.classList.toggle('hidden', !query);
  if (query) saveSearchHistory(query);

  if (state.searchController) state.searchController.abort();
  state.searchController = new AbortController();
  const signal = state.searchController.signal;

  searchResults.querySelectorAll('video').forEach((v) => {
    v.pause();
    v.src = '';
  });
  searchResults.innerHTML = '<div class="loading"><span class="spinner"></span>검색 중...</div>';

  try {
    const formData = new FormData();
    formData.append('indexId', state.currentProject.id);
    formData.append('searchOptions', JSON.stringify(getSearchOptions()));
    if (query) formData.append('query', query);
    if (searchImageFile) formData.append('image', searchImageFile);

    const res = await apiFetch(`${API}/api/search`, {
      method: 'POST',
      body: formData,
      signal,
    });
    if (!res.ok) throw new Error('검색 실패');
    const data = await res.json();
    if (signal.aborted) return;
    renderSearchResults(data.clips);
  } catch (err) {
    if (err.name === 'AbortError') return;
    searchResults.innerHTML = `<p class="placeholder-text">오류: ${escapeHtml(err.message)}</p>`;
  }
}

function renderSearchResults(clips) {
  searchResults.innerHTML = '';

  if (!clips || !clips.length) {
    searchResults.innerHTML = '<p class="placeholder-text">검색 결과가 없습니다.</p>';
    return;
  }

  clips.sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity));

  const grouped = new Map();
  clips.forEach((clip, i) => {
    const key = clip.videoId;
    if (!grouped.has(key)) {
      grouped.set(key, {
        title: clip.videoTitle || clip.videoId,
        duration: clip.videoDuration,
        assetId: clip.assetId,
        thumbnailUrl: clip.videoThumbnailUrl,
        hlsUrl: clip.hlsUrl,
        clips: [],
      });
    }
    grouped.get(key).clips.push({ ...clip, _index: i });
  });

  let html = '';
  for (const [videoId, group] of grouped) {
    const duration = group.duration;
    let timelineHtml = '';
    if (duration) {
      const segments = group.clips.map((c) => {
        const left = ((c.start || 0) / duration) * 100;
        const width = Math.max(((c.end - (c.start || 0)) / duration) * 100, 0.5);
        return `<div class="timeline-segment" data-clip-index="${c._index}" style="left:${left}%;width:${width}%" title="${formatTime(c.start)} – ${formatTime(c.end)}"></div>`;
      }).join('');
      timelineHtml = `
        <div class="timeline-bar-container">
          <div class="timeline-bar">${segments}</div>
          <div class="timeline-labels">
            <span>0:00</span><span>${formatTime(duration)}</span>
          </div>
        </div>`;
    }

    const clipsHtml = group.clips.map((clip) => {
      const thumbSrc = clip.thumbnailUrl
        ? `${clip.thumbnailUrl}${clip.thumbnailUrl.includes('?') ? '&' : '?'}time=${clip.start || 0}`
        : '';
      return `
      <div class="clip-card" data-index="${clip._index}">
        <div class="clip-info">
          <div class="clip-thumbnail">
            ${thumbSrc ? `<img src="${thumbSrc}" alt="thumbnail">` : '<div class="clip-thumbnail-placeholder"></div>'}
            <div class="clip-play-icon">&#9654;</div>
          </div>
          <div class="clip-meta">
            <div class="clip-meta-row">
              <span class="clip-time">${formatTime(clip.start)} – ${formatTime(clip.end)}</span>
              ${clip.rank ? `<span class="clip-confidence">#${clip.rank}</span>` : ''}
            </div>
            ${clip.transcription ? `<p class="clip-transcription">${escapeHtml(clip.transcription)}</p>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    const analyzeBtn = group.assetId
      ? `<button class="btn-analyze-video" data-video-id="${videoId}" data-asset-id="${group.assetId}" data-filename="${escapeHtml(group.title)}" data-duration="${group.duration || ''}" data-thumbnail="${group.thumbnailUrl || ''}" data-hls-url="${group.hlsUrl || ''}">이 영상 분석하기</button>`
      : '';

    html += `
    <div class="video-group">
      <div class="video-group-header">
        <span class="video-group-title">${escapeHtml(group.title)}</span>
        ${analyzeBtn}
      </div>
      ${timelineHtml}
      <div class="video-group-clips">${clipsHtml}</div>
    </div>`;
  }

  searchResults.innerHTML = html;

  searchResults.querySelectorAll('.clip-card').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.index);
      playClipInModal(clips[idx]);
    });
  });

  searchResults.querySelectorAll('.timeline-segment').forEach((seg) => {
    seg.addEventListener('click', () => {
      const idx = parseInt(seg.dataset.clipIndex);
      playClipInModal(clips[idx]);
    });
  });

  searchResults.querySelectorAll('.btn-analyze-video').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const video = {
        id: btn.dataset.videoId,
        assetId: btn.dataset.assetId,
        filename: btn.dataset.filename,
        duration: btn.dataset.duration ? parseFloat(btn.dataset.duration) : null,
        thumbnailUrl: btn.dataset.thumbnail || null,
        hlsUrl: btn.dataset.hlsUrl || null,
        status: 'ready',
      };
      selectVideoForAnalysis(video);
      updateAnalyzeIndicator();
      document.getElementById('tab-analyze').click();
      await navigateToVideoPage(video.id);
    });
  });
}

function playClipInModal(clip) {
  const modal = document.getElementById('modal-video-preview');
  const title = document.getElementById('modal-video-title');
  const body = document.getElementById('modal-video-body');

  title.textContent = `${clip.videoTitle || clip.videoId} (${formatTime(clip.start)} – ${formatTime(clip.end)})`;

  if (!clip.hlsUrl) {
    body.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;padding:16px">재생 가능한 스트림이 없습니다.</p>';
    modal.classList.remove('hidden');
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

  modal.classList.remove('hidden');
}
