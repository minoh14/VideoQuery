import { API, state } from './state.js';
import { escapeHtml, formatDuration, openModal, closeModals, showToast, showAlert } from './utils.js';
import { selectVideoForAnalysis } from './analyze.js';
import { apiFetch } from './auth.js';
import { fetchBatchMeta, renderTagChips, openMetaEditor } from './memos.js';

const videoList = document.getElementById('video-list');

export async function loadVideos() {
  if (!state.currentProject) return;

  try {
    const sortBy = document.getElementById('video-sort').value;
    const filterWrapper = document.getElementById('video-filter-wrapper');
    const filterInput = document.getElementById('video-filter-input');
    const filterText = filterInput && filterWrapper && !filterWrapper.classList.contains('hidden') ? filterInput.value.trim() : '';

    const params = new URLSearchParams({
      indexId: state.currentProject.id,
      page: state.videoPage,
      pageLimit: 10,
    });
    if (sortBy && sortBy !== 'newest') params.set('sortBy', sortBy);
    if (filterText) {
      params.set('filter', filterText);
      const fields = [];
      if (document.getElementById('filter-by-name')?.checked) fields.push('name');
      if (document.getElementById('filter-by-tag')?.checked) fields.push('tag');
      if (document.getElementById('filter-by-memo')?.checked) fields.push('memo');
      if (fields.length) params.set('filterFields', fields.join(','));
    }

    const res = await apiFetch(`${API}/api/videos?${params}`);
    const data = await res.json();
    state.videoTotalPage = data.pageInfo?.totalPage || 1;
    renderVideos(data.videos, data.pageInfo?.totalResults || data.videos.length);
    loadVideoMetas(data.videos);
  } catch (err) {
    videoList.innerHTML = '<li>영상 목록을 불러오지 못했습니다.</li>';
  }
}

async function loadVideoMetas(videos) {
  const ids = videos.filter((v) => v.status === 'ready').map((v) => v.id);
  if (!ids.length) return;
  try {
    const metas = await fetchBatchMeta(ids);
    Object.assign(state.videoMetas, metas);
    ids.forEach((id) => {
      const meta = state.videoMetas[id];
      const li = videoList.querySelector(`li[data-id="${id}"]`);
      if (!li) return;
      const existingTags = li.querySelector('.video-tags');
      if (existingTags) existingTags.remove();
      if (meta && meta.tags && meta.tags.length) {
        const content = li.querySelector('.video-item-content');
        const row = content.querySelector('.video-item-row');
        row.insertAdjacentHTML('afterend', renderTagChips(meta.tags));
      }
      const memoBtn = li.querySelector('.btn-memo');
      if (memoBtn) {
        const hasMemo = meta && (meta.memo || (meta.tags && meta.tags.length));
        memoBtn.classList.toggle('has-content', !!hasMemo);
      }
    });
  } catch {
    // silent
  }
}

function renderVideos(videos, totalResults) {
  state.videosCache = videos;
  updateAnalyzeVideoSelect();

  const unacknowledgedPending = state.pendingUploads.filter((p) => !p.assetId);
  const totalCount = totalResults + unacknowledgedPending.length;
  const totalDuration = state.currentProject ? (state.currentProject.totalDuration || 0) : 0;
  const durationText = totalDuration > 0 ? ` (${formatDuration(totalDuration)})` : '';
  document.getElementById('video-count').textContent = totalCount > 0 ? `(${totalCount})${durationText}` : '';

  const pendingHtml = state.pendingUploads
    .map((p) => {
      const isIndexing = Boolean(p.assetId);
      const progressClass = p.chunked ? 'progress-bar-fill determinate' : 'progress-bar-fill';
      const progressStyle = p.chunked ? `style="width:${Math.round(p.progress || 0)}%"` : '';
      return `
      <li class="pending-upload" data-upload-id="${p.id}">
        <div class="video-item-content">
          <div class="video-item-row">
            <span class="video-name">${escapeHtml(p.title)}</span>
            <span class="upload-progress-label">${p.chunked ? `${Math.round(p.progress || 0)}%` : ''}</span>
            <span class="badge ${isIndexing ? 'badge-indexing' : 'badge-uploading'}">${isIndexing ? '인덱싱 중' : '업로드 중'}</span>
          </div>
          <div class="progress-bar"><div class="${progressClass}" ${progressStyle}></div></div>
        </div>
      </li>`;
    })
    .join('');

  const settledAssetIds = new Set(
    videos.filter((v) => v.status === 'ready' || v.status === 'failed').map((v) => v.assetId).filter(Boolean)
  );
  if (settledAssetIds.size) {
    state.pendingUploads = state.pendingUploads.filter((p) => !p.assetId || !settledAssetIds.has(p.assetId));
  }
  const pendingAssetIds = new Set(state.pendingUploads.map((p) => p.assetId).filter(Boolean));
  const filteredVideos = videos.filter((v) => !pendingAssetIds.has(v.assetId));

  if (!filteredVideos.length && !state.pendingUploads.length) {
    videoList.innerHTML = '<li style="color:#6b7280">영상이 없습니다.</li>';
    return;
  }

  const videosHtml = filteredVideos
    .map((v) => {
      const badge = getBadge(v.status);
      const isProcessing = v.status !== 'ready' && v.status !== 'failed';
      const thumb = v.thumbnailUrl
        ? `<img class="video-item-thumb" src="${v.thumbnailUrl}" alt="">`
        : '<div class="video-item-thumb video-item-thumb-empty"></div>';
      const durationStr = v.duration ? formatDuration(v.duration) : '';
      const meta = state.videoMetas[v.id];
      const tagsHtml = meta ? renderTagChips(meta.tags) : '';
      const hasMemo = meta && (meta.memo || (meta.tags && meta.tags.length));
      return `
      <li data-id="${v.id}" data-asset-id="${v.assetId || ''}">
        <div class="video-item-content">
          <div class="video-item-row">
            ${thumb}
            <span class="video-name">${escapeHtml(v.filename || '제목 없음')}</span>
            ${durationStr ? `<span class="video-duration">${durationStr}</span>` : ''}
            <button class="btn-memo${hasMemo ? ' has-content' : ''}" data-id="${v.id}" title="메모/태그">&#9998;</button>
            <span class="badge ${badge.cls}">${badge.label}</span>
            <button class="btn-delete-video" data-id="${v.id}" title="삭제">&times;</button>
          </div>
          ${tagsHtml}
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

  videoList.querySelectorAll('.btn-memo').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const video = videos.find((v) => v.id === btn.dataset.id);
      if (video) openMetaEditor(video);
    });
  });

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
  import('./analyze.js').then(({ updateAnalyzeIndicator }) => updateAnalyzeIndicator());
}

function createPendingUpload(title, chunked = false) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title,
    assetId: null,
    progress: 0,
    chunked,
  };
}

function updatePendingUploadProgress(pending) {
  const item = videoList.querySelector(`[data-upload-id="${pending.id}"]`);
  if (!item) return;
  const fill = item.querySelector('.progress-bar-fill');
  const label = item.querySelector('.upload-progress-label');
  if (fill && pending.chunked) fill.style.width = `${pending.progress}%`;
  if (label && pending.chunked) label.textContent = `${Math.round(pending.progress)}%`;
}

export async function navigateToVideoPage(videoId) {
  if (!state.currentProject) return;
  const res = await apiFetch(`${API}/api/videos/statuses?indexId=${state.currentProject.id}`);
  const data = await res.json();
  const statuses = data.statuses || [];
  const idx = statuses.findIndex((v) => v.id === videoId);
  if (idx === -1) return;
  const pageLimit = 10;
  const targetPage = Math.floor(idx / pageLimit) + 1;
  state.videoPage = targetPage;
  await loadVideos();
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
      return { cls: 'badge-indexing', label: '인덱싱 중' };
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
    const pendingWithAsset = state.pendingUploads.filter((p) => p.assetId).map((p) => p.assetId);
    const params = new URLSearchParams({ indexId: state.currentProject.id });
    if (pendingWithAsset.length) params.set('pendingAssetIds', pendingWithAsset.join(','));
    const res = await apiFetch(`${API}/api/videos/statuses?${params}`);
    const data = await res.json();
    const statuses = data.statuses || [];
    const pendingStatuses = data.pendingStatuses || [];

    const allAssetIds = new Set(statuses.map((s) => s.assetId).filter(Boolean));
    const stillProcessingAssetIds = new Set(
      pendingStatuses.filter((s) => s.status !== 'failed').map((s) => s.assetId)
    );
    state.pendingUploads = state.pendingUploads.filter((p) =>
      !p.assetId || (!allAssetIds.has(p.assetId) && stillProcessingAssetIds.has(p.assetId))
    );

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
  const pending = createPendingUpload(title);
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

const CHUNK_CONCURRENCY = 3;
const REPORT_BATCH_SIZE = 5;
const CHUNK_MAX_RETRIES = 3;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getResponseError(res, fallback) {
  const data = await res.json().catch(() => ({}));
  return data.error || fallback;
}

async function uploadChunk(uploadId, chunkIndex, chunk) {
  let lastError;
  for (let attempt = 0; attempt <= CHUNK_MAX_RETRIES; attempt++) {
    try {
      const res = await apiFetch(
        `${API}/api/videos/multipart/chunk?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${chunkIndex}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunk,
        }
      );
      if (res.ok) return res.json();
      lastError = new Error(await getResponseError(res, `청크 ${chunkIndex} 업로드 실패`));
    } catch (err) {
      lastError = err;
    }
    if (attempt < CHUNK_MAX_RETRIES) await wait(500 * (2 ** attempt));
  }
  throw lastError || new Error(`청크 ${chunkIndex} 업로드 실패`);
}

async function reportChunks(uploadId, completedChunks) {
  let lastError;
  for (let attempt = 0; attempt <= CHUNK_MAX_RETRIES; attempt++) {
    try {
      const res = await apiFetch(`${API}/api/videos/multipart/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId, completedChunks }),
      });
      if (res.ok) return res.json();
      lastError = new Error(await getResponseError(res, '청크 완료 보고 실패'));
    } catch (err) {
      lastError = err;
    }
    if (attempt < CHUNK_MAX_RETRIES) await wait(500 * (2 ** attempt));
  }
  throw lastError || new Error('청크 완료 보고 실패');
}

async function uploadFileInChunks(file, onProgress) {
  const initRes = await apiFetch(`${API}/api/videos/multipart/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      indexId: state.currentProject.id,
      filename: file.name,
      fileSize: file.size,
      contentType: file.type,
    }),
  });
  if (!initRes.ok) throw new Error(await getResponseError(initRes, '대용량 업로드를 시작하지 못했습니다.'));

  const session = await initRes.json();
  const chunkSize = Number(session.chunkSize);
  const totalChunks = Number(session.totalChunks);
  if (!session.uploadId || !chunkSize || !totalChunks) {
    throw new Error('업로드 세션 정보가 올바르지 않습니다.');
  }

  let nextChunkIndex = 1;
  let uploadedChunks = 0;
  let pendingReports = [];
  let reportChain = Promise.resolve();
  let lastReport = null;

  const queueReport = (chunks) => {
    reportChain = reportChain.then(async () => {
      lastReport = await reportChunks(session.uploadId, chunks);
    });
    return reportChain;
  };

  async function worker() {
    while (true) {
      const chunkIndex = nextChunkIndex++;
      if (chunkIndex > totalChunks) return;

      const start = (chunkIndex - 1) * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const result = await uploadChunk(session.uploadId, chunkIndex, file.slice(start, end));
      pendingReports.push(result);
      uploadedChunks++;
      onProgress((uploadedChunks / totalChunks) * 100);

      if (pendingReports.length >= REPORT_BATCH_SIZE) {
        const batch = pendingReports;
        pendingReports = [];
        await queueReport(batch);
      }
    }
  }

  await Promise.all(Array.from({ length: CHUNK_CONCURRENCY }, () => worker()));
  if (pendingReports.length) await queueReport(pendingReports);
  await reportChain;

  if (!lastReport?.uploadComplete) {
    throw new Error('모든 청크가 업로드되었지만 서버가 완료 상태를 확인하지 못했습니다.');
  }
  return lastReport;
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
    const pending = createPendingUpload(file.name, true);
    state.pendingUploads.push(pending);
    return { file, pending };
  });
  loadVideos();

  await Promise.all(pendings.map(async ({ file, pending }) => {
    try {
      const data = await uploadFileInChunks(file, (progress) => {
        pending.progress = progress;
        updatePendingUploadProgress(pending);
      });
      pending.assetId = data.assetId;
      pending.progress = 100;
      updatePendingUploadProgress(pending);
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
