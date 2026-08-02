import { API, state } from './state.js';
import { escapeHtml, formatTime } from './utils.js';
import { closeVideoPreview } from './videos.js';

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const imageInput = document.getElementById('input-search-image');
const imageNameEl = document.getElementById('search-image-name');
const btnRemoveImage = document.getElementById('btn-remove-image');

let searchImageFile = null;

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

    const res = await fetch(`${API}/api/search`, {
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
    </div>`;
      }
    )
    .join('');

  searchResults.querySelectorAll('.clip-card').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.index);
      const clip = clips[idx];
      playClipInModal(clip);
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
