import { API, state } from './state.js';
import { escapeHtml, formatTime, showToast } from './utils.js';
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
const searchExportToolbar = document.getElementById('search-export-toolbar');
const searchResultsCount = document.getElementById('search-results-count');
const bookmarkList = document.getElementById('bookmark-list');
const bookmarkCount = document.getElementById('bookmark-count');

const HISTORY_KEY_PREFIX = 'videoquery_search_history_';
const MAX_HISTORY = 20;

let searchImageFile = null;
let currentSearchExport = null;
let currentBookmarks = [];
let bookmarkProjectId = null;

function setSearchExportState(exportData) {
  currentSearchExport = exportData;
  const hasResults = Boolean(exportData?.clips?.length);
  searchExportToolbar.classList.toggle('hidden', !hasResults);
  searchResultsCount.textContent = hasResults ? `${exportData.clips.length}개 결과` : '';
}

export function resetSearchState() {
  setSearchExportState(null);
  currentBookmarks = [];
  bookmarkProjectId = null;
  renderBookmarks();
}

function getBookmarkKey(clip) {
  return `${clip.videoId}|${Number(clip.start)}|${Number(clip.end)}`;
}

function isBookmarked(clip) {
  return currentBookmarks.some((bookmark) => getBookmarkKey(bookmark) === getBookmarkKey(clip));
}

export async function loadBookmarks() {
  const projectId = state.currentProject?.id;
  if (!projectId) return;
  bookmarkProjectId = projectId;

  try {
    const res = await apiFetch(`${API}/api/bookmarks?projectId=${encodeURIComponent(projectId)}`);
    if (!res.ok) throw new Error('북마크를 불러오지 못했습니다.');
    const data = await res.json();
    if (state.currentProject?.id !== projectId) return;
    currentBookmarks = data.bookmarks || [];
    renderBookmarks();
    if (currentSearchExport?.projectId === projectId) renderCurrentSearchResults();
  } catch (err) {
    if (state.currentProject?.id === projectId) {
      currentBookmarks = [];
      renderBookmarks();
    }
  }
}

function renderBookmarks() {
  if (!bookmarkList || !bookmarkCount) return;
  bookmarkCount.textContent = `(${currentBookmarks.length})`;
  if (!currentBookmarks.length) {
    bookmarkList.innerHTML = '<li class="bookmark-empty">저장한 클립이 없습니다.</li>';
    return;
  }

  bookmarkList.innerHTML = currentBookmarks.map((bookmark) => `
    <li class="bookmark-item" data-bookmark-id="${bookmark.id}">
      <button class="bookmark-item-main" type="button">
        <span class="bookmark-item-title">${escapeHtml(bookmark.videoTitle)}</span>
        <span class="bookmark-item-time">${formatTime(bookmark.start)} – ${formatTime(bookmark.end)}</span>
      </button>
      <button class="bookmark-item-delete" type="button" title="북마크 삭제" aria-label="북마크 삭제">&times;</button>
    </li>`).join('');

  bookmarkList.querySelectorAll('.bookmark-item-main').forEach((button) => {
    button.addEventListener('click', () => {
      const item = currentBookmarks.find((bookmark) => bookmark.id === button.parentElement.dataset.bookmarkId);
      if (item) playClipInModal(item);
    });
  });
  bookmarkList.querySelectorAll('.bookmark-item-delete').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = button.parentElement;
      try {
        await deleteBookmark(item.dataset.bookmarkId);
        showToast('북마크를 삭제했습니다.');
      } catch (err) {
        showToast(err.message || '북마크 삭제에 실패했습니다.', 'error');
      }
    });
  });
}

async function saveBookmark(clip) {
  const projectId = state.currentProject?.id;
  if (!projectId || isBookmarked(clip)) return;
  const res = await apiFetch(`${API}/api/bookmarks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId,
      videoId: clip.videoId,
      assetId: clip.assetId,
      videoTitle: clip.videoTitle,
      start: clip.start,
      end: clip.end,
      rank: clip.rank,
      transcription: clip.transcription,
      thumbnailUrl: clip.videoThumbnailUrl || clip.thumbnailUrl,
      hlsUrl: clip.hlsUrl,
      query: currentSearchExport?.query || '',
    }),
  });
  if (!res.ok) throw new Error(await getResponseError(res, '북마크 저장에 실패했습니다.'));
  currentBookmarks.unshift(await res.json());
  renderBookmarks();
}

async function deleteBookmark(bookmarkId) {
  const projectId = state.currentProject?.id;
  if (!projectId) return;
  const res = await apiFetch(
    `${API}/api/bookmarks/${encodeURIComponent(bookmarkId)}?projectId=${encodeURIComponent(projectId)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error(await getResponseError(res, '북마크 삭제에 실패했습니다.'));
  currentBookmarks = currentBookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
  renderBookmarks();
  if (currentSearchExport?.projectId === projectId) renderCurrentSearchResults();
}

async function toggleBookmark(clip) {
  try {
    const existing = currentBookmarks.find((bookmark) => getBookmarkKey(bookmark) === getBookmarkKey(clip));
    if (existing) {
      await deleteBookmark(existing.id);
      showToast('북마크를 삭제했습니다.');
    } else {
      await saveBookmark(clip);
      renderCurrentSearchResults();
      showToast('클립을 북마크에 저장했습니다.');
    }
  } catch (err) {
    showToast(err.message || '북마크 처리에 실패했습니다.', 'error');
  }
}

function getHistoryKey() {
  return HISTORY_KEY_PREFIX + (state.currentProject?.id || 'global');
}

async function getResponseError(res, fallback) {
  const data = await res.json().catch(() => ({}));
  return data.error || fallback;
}

function getSearchHistory() {
  try {
    return JSON.parse(localStorage.getItem(getHistoryKey())) || [];
  } catch { return []; }
}

function formatLocalDateTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} GMT${offset}`;
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
  setSearchExportState(null);
  searchResults.innerHTML = '<p class="placeholder-text">프로젝트 내 영상에서 장면을 검색합니다.</p>';
});

document.querySelectorAll('.btn-export-search').forEach((button) => {
  button.addEventListener('click', () => exportSearchResults(button.dataset.format));
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
  setSearchExportState(null);
  searchResults.innerHTML = '<div class="loading"><span class="spinner"></span>검색 중...</div>';

  try {
    const formData = new FormData();
    formData.append('indexId', state.currentProject.id);
    const searchOptions = getSearchOptions();
    formData.append('searchOptions', JSON.stringify(searchOptions));
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
    renderSearchResults(data.clips, { query, searchOptions });
  } catch (err) {
    if (err.name === 'AbortError') return;
    setSearchExportState(null);
    searchResults.innerHTML = `<p class="placeholder-text">오류: ${escapeHtml(err.message)}</p>`;
  }
}

function renderSearchResults(clips, searchMeta = {}) {
  searchResults.innerHTML = '';

  if (!clips || !clips.length) {
    setSearchExportState(null);
    searchResults.innerHTML = '<p class="placeholder-text">검색 결과가 없습니다.</p>';
    return;
  }

  clips = [...clips].sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity));
  setSearchExportState({
    projectId: state.currentProject?.id,
    query: searchMeta.query || '',
    searchOptions: searchMeta.searchOptions || [],
    exportedAt: searchMeta.exportedAt || formatLocalDateTime(),
    clips,
  });

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
              <button class="btn-bookmark-clip${isBookmarked(clip) ? ' active' : ''}" data-index="${clip._index}" type="button" title="${isBookmarked(clip) ? '북마크 삭제' : '북마크 저장'}" aria-label="${isBookmarked(clip) ? '북마크 삭제' : '북마크 저장'}" aria-pressed="${isBookmarked(clip)}">${isBookmarked(clip) ? '&#9733;' : '&#9734;'}</button>
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

  searchResults.querySelectorAll('.btn-bookmark-clip').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const clip = clips[parseInt(button.dataset.index)];
      if (clip) toggleBookmark(clip);
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

function renderCurrentSearchResults() {
  if (!currentSearchExport?.clips?.length) return;
  renderSearchResults(currentSearchExport.clips, currentSearchExport);
}

function normalizeSearchClip(clip) {
  return {
    rank: clip.rank ?? null,
    videoId: clip.videoId || '',
    videoTitle: clip.videoTitle || clip.videoId || '',
    assetId: clip.assetId || null,
    startSeconds: clip.start ?? null,
    endSeconds: clip.end ?? null,
    startTimestamp: formatTime(clip.start),
    endTimestamp: formatTime(clip.end),
    durationSeconds: clip.videoDuration ?? null,
    transcription: clip.transcription || '',
    thumbnailUrl: clip.thumbnailUrl || clip.videoThumbnailUrl || null,
    hlsUrl: clip.hlsUrl || null,
  };
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function getExportRows() {
  return currentSearchExport.clips.map(normalizeSearchClip);
}

function buildCsv(rows) {
  const headers = [
    'rank', 'video_id', 'video_title', 'asset_id',
    'start_seconds', 'end_seconds', 'start_timestamp', 'end_timestamp',
    'duration_seconds', 'transcription', 'thumbnail_url', 'hls_url',
  ];
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    lines.push([
      row.rank, row.videoId, row.videoTitle, row.assetId,
      row.startSeconds, row.endSeconds, row.startTimestamp, row.endTimestamp,
      row.durationSeconds, row.transcription, row.thumbnailUrl, row.hlsUrl,
    ].map(csvEscape).join(','));
  });
  return `\uFEFF${lines.join('\r\n')}`;
}

function buildMarkdown(rows) {
  const query = currentSearchExport.query || '(이미지 검색)';
  const projectName = state.currentProject?.name || state.currentProject?.id || '';
  const groups = new Map();
  rows.forEach((row) => {
    if (!groups.has(row.videoId)) groups.set(row.videoId, []);
    groups.get(row.videoId).push(row);
  });

  const lines = [
    '# VideoQuery 검색 결과',
    '',
    `- 프로젝트: ${projectName}`,
    `- 검색어: ${query}`,
    `- 검색 옵션: ${currentSearchExport.searchOptions.join(', ') || '-'}`,
    `- 결과 수: ${rows.length}`,
    `- 내보낸 시각: ${currentSearchExport.exportedAt}`,
    '',
  ];

  for (const videoRows of groups.values()) {
    lines.push(`## ${videoRows[0].videoTitle}`, '');
    videoRows.forEach((row) => {
      lines.push(`- **${row.startTimestamp} – ${row.endTimestamp}** (순위 #${row.rank ?? '-'})`);
      if (row.transcription) lines.push(`  - 대사: ${row.transcription}`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

function buildJson(rows) {
  return JSON.stringify({
    project: {
      id: state.currentProject?.id || null,
      name: state.currentProject?.name || null,
    },
    query: currentSearchExport.query,
    searchOptions: currentSearchExport.searchOptions,
    exportedAt: currentSearchExport.exportedAt,
    resultCount: rows.length,
    results: rows,
  }, null, 2);
}

function sanitizeFilename(value) {
  return (value || 'videoquery-search')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function downloadExport(content, filename, type) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportSearchResults(format) {
  if (!currentSearchExport?.clips?.length) return;

  const rows = getExportRows();
  const baseName = sanitizeFilename(
    `${state.currentProject?.name || 'project'}-${currentSearchExport.query || 'image-search'}`
  );

  if (format === 'csv') {
    downloadExport(buildCsv(rows), `${baseName}.csv`, 'text/csv');
  } else if (format === 'markdown') {
    downloadExport(buildMarkdown(rows), `${baseName}.md`, 'text/markdown');
  } else if (format === 'json') {
    downloadExport(buildJson(rows), `${baseName}.json`, 'application/json');
  }
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
