import { API, state } from './state.js';
import { escapeHtml, formatDuration, openModal, closeModals, showToast, showAlert } from './utils.js';
import { selectVideoForAnalysis } from './analyze.js';
import { apiFetch } from './auth.js';

const videoList = document.getElementById('video-list');

export async function loadVideos() {
  if (!state.currentProject) return;

  try {
    const res = await apiFetch(`${API}/api/videos?indexId=${state.currentProject.id}&page=${state.videoPage}&pageLimit=10`);
    const data = await res.json();
    state.videoTotalPage = data.pageInfo?.totalPage || 1;
    renderVideos(data.videos, data.pageInfo?.totalResults || data.videos.length);
  } catch (err) {
    videoList.innerHTML = '<li>영상 목록을 불러오지 못했습니다.</li>';
  }
}

function renderVideos(videos, totalResults) {
  state.videosCache = videos;
  updateAnalyzeVideoSelect();

  const filterInput = document.getElementById('video-filter-input');
  const filterText = filterInput && !filterInput.classList.contains('hidden') ? filterInput.value.trim().toLowerCase() : '';
  if (filterText) {
    videos = videos.filter((v) => (v.filename || '').toLowerCase().includes(filterText));
  }

  const unacknowledgedPending = state.pendingUploads.filter((p) => !p.assetId);
  const totalCount = totalResults + unacknowledgedPending.length;
  const totalDuration = state.currentProject ? (state.currentProject.totalDuration || 0) : 0;
  const durationText = totalDuration > 0 ? ` (${formatDuration(totalDuration)})` : '';
  document.getElementById('video-count').textContent = totalCount > 0 ? `(${totalCount})${durationText}` : '';

  const pendingHtml = state.pendingUploads
    .map((p) => `
      <li class="pending-upload">
        <div class="video-item-content">
          <div class="video-item-row">
            <span class="video-name">${escapeHtml(p.title)}</span>
            <span class="badge badge-uploading">업로드 중</span>
          </div>
          <div class="progress-bar"><div class="progress-bar-fill"></div></div>
        </div>
      </li>`)
    .join('');

  if (!videos.length && !state.pendingUploads.length) {
    videoList.innerHTML = '<li style="color:#6b7280">영상이 없습니다.</li>';
    return;
  }

  const videosHtml = videos
    .map((v) => {
      const badge = getBadge(v.status);
      const isProcessing = v.status !== 'ready' && v.status !== 'failed';
      const thumb = v.thumbnailUrl
        ? `<img class="video-item-thumb" src="${v.thumbnailUrl}" alt="">`
        : '<div class="video-item-thumb video-item-thumb-empty"></div>';
      const durationStr = v.duration ? formatDuration(v.duration) : '';
      return `
      <li data-id="${v.id}" data-asset-id="${v.assetId || ''}">
        <div class="video-item-content">
          <div class="video-item-row">
            ${thumb}
            <span class="video-name">${escapeHtml(v.filename || '제목 없음')}</span>
            ${durationStr ? `<span class="video-duration">${durationStr}</span>` : ''}
            <span class="badge ${badge.cls}">${badge.label}</span>
            <button class="btn-delete-video" data-id="${v.id}" title="삭제">&times;</button>
          </div>
          ${isProcessing ? '<div class="progress-bar"><div class="progress-bar-fill"></div></div>' : ''}
        </div>
      </li>`;
    })
    .join('');

  videoList.innerHTML = pendingHtml + videosHtml;

  const paginationEl = document.getElementById('video-pagination');
  if (state.videoTotalPage > 1) {
    paginationEl.innerHTML = `
      <button class="btn-page${state.videoPage <= 1 ? ' disabled' : ''}" id="btn-first-page">&laquo;</button>
      <button class="btn-page${state.videoPage <= 1 ? ' disabled' : ''}" id="btn-prev-page">&lsaquo;</button>
      <span class="page-info">${state.videoPage} / ${state.videoTotalPage}</span>
      <button class="btn-page${state.videoPage >= state.videoTotalPage ? ' disabled' : ''}" id="btn-next-page">&rsaquo;</button>
      <button class="btn-page${state.videoPage >= state.videoTotalPage ? ' disabled' : ''}" id="btn-last-page">&raquo;</button>`;
  } else {
    paginationEl.innerHTML = '';
  }

  videoList.querySelectorAll('.btn-delete-video').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.deleteTarget = btn.dataset.id;
      openModal('modal-delete');
    });
  });

  videoList.querySelectorAll('li[data-id]').forEach((li) => {
    li.addEventListener('click', () => {
      const video = videos.find((v) => v.id === li.dataset.id);
      if (!video) return;
      const analyzeActive = document.getElementById('panel-analyze').classList.contains('active');
      if (analyzeActive) {
        if (video.status === 'ready') {
          selectVideoForAnalysis(video);
          videoList.querySelectorAll('li[data-id]').forEach((el) => el.classList.remove('selected'));
          li.classList.add('selected');
        }
      } else {
        showVideoPreview(video);
      }
    });
  });

  if (document.getElementById('panel-analyze').classList.contains('active') && state.selectedAnalyzeVideo) {
    const selectedLi = videoList.querySelector(`li[data-id="${state.selectedAnalyzeVideo.id}"]`);
    if (selectedLi) selectedLi.classList.add('selected');
  }

  const firstBtn = document.getElementById('btn-first-page');
  const prevBtn = document.getElementById('btn-prev-page');
  const nextBtn = document.getElementById('btn-next-page');
  const lastBtn = document.getElementById('btn-last-page');
  if (firstBtn) {
    firstBtn.addEventListener('click', () => {
      if (state.videoPage > 1) { state.videoPage = 1; loadVideos(); }
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (state.videoPage > 1) { state.videoPage--; loadVideos(); }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (state.videoPage < state.videoTotalPage) { state.videoPage++; loadVideos(); }
    });
  }
  if (lastBtn) {
    lastBtn.addEventListener('click', () => {
      if (state.videoPage < state.videoTotalPage) { state.videoPage = state.videoTotalPage; loadVideos(); }
    });
  }
}

function updateAnalyzeVideoSelect() {
  if (state.selectedAnalyzeVideo && !state.videosCache.some((v) => v.id === state.selectedAnalyzeVideo.id && v.status === 'ready')) {
    state.selectedAnalyzeVideo = null;
  }
  // Lazy import to avoid circular dependency at module load
  import('./analyze.js').then(({ updateAnalyzeIndicator }) => updateAnalyzeIndicator());
}

export function showVideoPreview(video) {
  const modal = document.getElementById('modal-video-preview');
  const title = document.getElementById('modal-video-title');
  const body = document.getElementById('modal-video-body');

  title.textContent = video.filename || '제목 없음';

  const thumbSrc = video.thumbnailUrl || '';
  body.innerHTML = `
    <div class="video-preview-thumbnail" id="video-preview-player">
      ${thumbSrc ? `<img src="${thumbSrc}" alt="thumbnail">` : '<div class="clip-thumbnail-placeholder" style="height:300px"></div>'}
      <div class="clip-play-icon">&#9654;</div>
    </div>`;

  modal.classList.remove('hidden');

  document.getElementById('video-preview-player').addEventListener('click', () => {
    if (!video.hlsUrl) {
      body.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;padding:16px">재생 가능한 스트림이 없습니다.</p>';
      return;
    }
    const container = document.getElementById('video-preview-player');
    const videoEl = document.createElement('video');
    videoEl.controls = true;
    videoEl.autoplay = true;
    videoEl.style.width = '100%';
    videoEl.style.borderRadius = '8px';
    container.innerHTML = '';
    container.appendChild(videoEl);

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(video.hlsUrl);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play());
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      videoEl.src = video.hlsUrl;
      videoEl.addEventListener('loadedmetadata', () => videoEl.play());
    }
  });
}

export function closeVideoPreview() {
  const modal = document.getElementById('modal-video-preview');
  const body = document.getElementById('modal-video-body');
  body.querySelectorAll('video').forEach((v) => { v.pause(); v.src = ''; });
  body.innerHTML = '';
  modal.classList.add('hidden');
}

function getBadge(status) {
  const analyzeActive = document.getElementById('panel-analyze').classList.contains('active');
  switch (status) {
    case 'ready':
      return analyzeActive
        ? { cls: 'badge-analyze-ready', label: '분석 가능' }
        : { cls: 'badge-ready', label: '검색 가능' };
    case 'indexing':
      return { cls: 'badge-indexing', label: '인덱싱 중' };
    case 'pending':
      return { cls: 'badge-uploading', label: '대기 중' };
    case 'failed':
      return { cls: 'badge-failed', label: '실패' };
    default:
      return { cls: 'badge-uploading', label: '처리 중' };
  }
}

export function startPolling() {
  stopPolling();
  pollVideos();
  state.pollInterval = setInterval(pollVideos, 5000);
}

async function pollVideos() {
  await loadVideos();
  const hasProcessing = await checkStatuses();
  if (!hasProcessing && !state.pendingUploads.length) {
    stopPolling();
  }
}

async function checkStatuses() {
  if (!state.currentProject) return false;
  try {
    const res = await apiFetch(`${API}/api/videos/statuses?indexId=${state.currentProject.id}`);
    const data = await res.json();
    const statuses = data.statuses || [];

    const allAssetIds = new Set(statuses.map((s) => s.assetId).filter(Boolean));
    state.pendingUploads = state.pendingUploads.filter((p) => !p.assetId || !allAssetIds.has(p.assetId));

    let hasProcessing = false;
    for (const item of statuses) {
      const prev = state.allVideoStatuses[item.id];
      if (item.status === 'ready' && prev && prev !== 'ready') {
        showToast(`"${item.filename || '영상'}" 인덱싱 완료`);
      }
      state.allVideoStatuses[item.id] = item.status;
      if (item.status !== 'ready' && item.status !== 'failed') {
        hasProcessing = true;
      }
    }
    return hasProcessing;
  } catch (err) {
    return false;
  }
}

export function stopPolling() {
  if (state.pollInterval) {
    clearInterval(state.pollInterval);
    state.pollInterval = null;
  }
}

export function ensurePolling() {
  if (!state.pollInterval) {
    startPolling();
  }
}

export async function uploadVideo() {
  if (state.uploadMode === 'url') {
    await uploadVideoByUrl();
  } else {
    await uploadVideoByFile();
  }
}

async function uploadVideoByUrl() {
  const urlInput = document.getElementById('input-video-url');
  const titleInput = document.getElementById('input-video-title');
  const url = urlInput.value.trim();
  if (!url) return;

  if (/(?:youtube\.com|youtu\.be)/.test(url)) {
    showAlert('유튜브 영상은 업로드할 수 없습니다.');
    return;
  }

  const btn = document.getElementById('btn-upload-video');
  btn.disabled = true;

  const title = titleInput.value.trim() || url.split('/').pop() || '새 영상';
  const pending = { title, assetId: null };
  state.pendingUploads.push(pending);

  urlInput.value = '';
  titleInput.value = '';
  closeModals();
  loadVideos();

  try {
    const res = await apiFetch(`${API}/api/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        indexId: state.currentProject.id,
        url,
        title: title,
      }),
    });
    if (!res.ok) throw new Error('업로드 실패');
    const data = await res.json();
    pending.assetId = data.assetId;
    loadVideos();
    ensurePolling();
  } catch (err) {
    state.pendingUploads = state.pendingUploads.filter((p) => p !== pending);
    loadVideos();
    showAlert('영상 추가에 실패했습니다.');
  } finally {
    btn.disabled = false;
  }
}

async function uploadVideoByFile() {
  const fileInput = document.getElementById('input-video-file');
  const files = Array.from(fileInput.files);
  if (!files.length) return;

  const btn = document.getElementById('btn-upload-video');
  btn.disabled = true;

  fileInput.value = '';
  document.getElementById('file-drop-name').textContent = '';
  closeModals();

  const pendings = files.map((file) => {
    const pending = { title: file.name, assetId: null };
    state.pendingUploads.push(pending);
    return { file, pending };
  });
  loadVideos();

  await Promise.all(pendings.map(async ({ file, pending }) => {
    try {
      const formData = new FormData();
      formData.append('indexId', state.currentProject.id);
      formData.append('file', file);

      const res = await apiFetch(`${API}/api/videos/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('업로드 실패');
      const data = await res.json();
      pending.assetId = data.assetId;
    } catch (err) {
      state.pendingUploads = state.pendingUploads.filter((p) => p !== pending);
      showToast(`${file.name} 업로드 실패`, 'error');
    }
  }));

  loadVideos();
  ensurePolling();
  btn.disabled = false;
}

export async function deleteVideo() {
  if (!state.deleteTarget || !state.currentProject) return;

  const btn = document.getElementById('btn-confirm-delete');
  btn.disabled = true;

  try {
    const res = await apiFetch(
      `${API}/api/videos/${state.deleteTarget}?indexId=${state.currentProject.id}`,
      { method: 'DELETE' }
    );
    if (!res.ok) throw new Error('삭제 실패');
    if (state.selectedAnalyzeVideo && state.selectedAnalyzeVideo.id === state.deleteTarget) {
      state.selectedAnalyzeVideo = null;
      import('./analyze.js').then(({ resetChat, updateAnalyzeIndicator }) => {
        resetChat();
        updateAnalyzeIndicator();
      });
    }
    state.deleteTarget = null;
    closeModals();
    loadVideos();
  } catch (err) {
    showAlert('영상 삭제에 실패했습니다.');
  } finally {
    btn.disabled = false;
  }
}
