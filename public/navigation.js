import { state } from './state.js';
import { loadProjects } from './projects.js';
import { loadVideos, stopPolling, startPolling } from './videos.js';
import { updateAnalyzeIndicator, resetChat } from './analyze.js';
import { loadBookmarks, resetSearchState } from './search.js';

const projectsView = document.getElementById('projects-view');
const workspaceView = document.getElementById('workspace-view');
const workspaceTitle = document.getElementById('workspace-title');
const searchResults = document.getElementById('search-results');
const analyzeResults = document.getElementById('analyze-results');

function showView(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  view.classList.add('active');
}

export function goToProjects() {
  state.currentProject = null;
  stopPolling();
  showView(projectsView);
  loadProjects();
}

export function goToWorkspace(project) {
  state.currentProject = project;
  state.videoPage = 1;
  state.selectedAnalyzeVideo = null;
  state.allVideoStatuses = {};
  state.pendingUploads = [];
  workspaceTitle.textContent = project.name;
  resetSearchState();
  searchResults.innerHTML = '<p class="placeholder-text">프로젝트 내 영상에서 장면을 검색합니다.</p>';
  resetChat();
  updateAnalyzeIndicator();
  showView(workspaceView);
  loadBookmarks();
  loadVideos();
  startPolling();
}
