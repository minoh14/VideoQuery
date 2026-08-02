import { API, state } from './state.js';
import { escapeHtml, formatTime } from './utils.js';

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

function getSearchOptions() {
  const checked = document.querySelectorAll('.search-options input:checked');
  const options = Array.from(checked).map((el) => el.value);
  return options.length > 0 ? options : ['visual'];
}

export async function executeSearch() {
  const query = searchInput.value.trim();
  if (!query || !state.currentProject) return;

  if (state.searchController) state.searchController.abort();
  state.searchController = new AbortController();
  const signal = state.searchController.signal;

  searchResults.querySelectorAll('video').forEach((v) => {
    v.pause();
    v.src = '';
  });
  searchResults.innerHTML = '<div class="loading"><span class="spinner"></span>검색 중...</div>';

  try {
    const res = await fetch(`${API}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indexId: state.currentProject.id,
        query,
        searchOptions: getSearchOptions(),
      }),
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

  searchResults.innerHTML = clips
    .map(
      (clip, i) => {
        const thumbSrc = clip.thumbnailUrl
          ? `${clip.thumbnailUrl}${clip.thumbnailUrl.includes('?') ? '&' : '?'}time=${clip.start || 0}`
          : '';
        return `
    <div class="clip-card" data-index="${i}">
      <div class="clip-info">
        <div class="clip-thumbnail">
          ${thumbSrc ? `<img src="${thumbSrc}" alt="thumbnail">` : '<div class="clip-thumbnail-placeholder"></div>'}
          <div class="clip-play-icon">&#9654;</div>
        </div>
        <div class="clip-meta">
          <span class="clip-title">${escapeHtml(clip.videoTitle || clip.videoId)}</span>
          <span class="clip-time">${formatTime(clip.start)} – ${formatTime(clip.end)}</span>
          ${clip.transcription ? `<p class="clip-transcription">${escapeHtml(clip.transcription)}</p>` : ''}
        </div>
      </div>
      <div class="clip-player-container" id="player-${i}"></div>
    </div>`;
      }
    )
    .join('');

  searchResults.querySelectorAll('.clip-card').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.index);
      const clip = clips[idx];
      playClip(idx, clip);
    });
  });
}

function playClip(index, clip) {
  const container = document.getElementById(`player-${index}`);
  if (container.querySelector('video')) {
    container.innerHTML = '';
    return;
  }

  if (!clip.hlsUrl) {
    container.innerHTML = '<p style="color:#6b7280;font-size:0.8rem;padding:8px">재생 가능한 스트림이 없습니다.</p>';
    return;
  }

  const video = document.createElement('video');
  video.controls = true;
  video.autoplay = true;
  video.style.width = '100%';
  video.style.borderRadius = '6px';
  video.style.marginTop = '10px';
  container.innerHTML = '';
  container.appendChild(video);

  const startTime = clip.start || 0;
  const endTime = clip.end;

  function onTimeUpdate() {
    if (endTime != null && video.currentTime >= endTime) {
      video.pause();
      video.removeEventListener('timeupdate', onTimeUpdate);
    }
  }
  video.addEventListener('timeupdate', onTimeUpdate);

  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(clip.hlsUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.currentTime = startTime;
      video.play();
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = clip.hlsUrl;
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = startTime;
      video.play();
    });
  }
}
