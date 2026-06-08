// ===== 记忆曲线任务日历 - CloudBase 版本 =====

var DEFAULT_INTERVALS = [1, 3, 6, 13, 27];
var REVIEW_INTERVALS = DEFAULT_INTERVALS.slice();

var currentUser = null;
var currentYear, currentMonth;
var tasks = {};
var editingTask = null;
var newTaskImages = [];
var detailEditImages = { existing: [], newFiles: [], removed: [] };
var detailTaskRef = null;
var detailViewMeta = '';

// ===== 认证检查 =====
function checkAuth() {
  try {
    var u = JSON.parse(localStorage.getItem('user'));
    if (u && u.id && u.username) {
      currentUser = u;
      return true;
    }
  } catch (e) {}
  var redirect = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = '/login.html?redirect=' + redirect;
  return false;
}

function getUserId() {
  return currentUser ? currentUser.id : '';
}

// ===== 操作历史 =====
var operationHistory = [];
var HISTORY_MAX = 50;

function loadHistory() {
  try {
    var raw = localStorage.getItem('mcs_history_' + getUserId());
    if (raw) operationHistory = JSON.parse(raw);
  } catch (e) { operationHistory = []; }
}

function saveHistory() {
  try {
    var toSave = operationHistory.slice(0, HISTORY_MAX);
    localStorage.setItem('mcs_history_' + getUserId(), JSON.stringify(toSave));
  } catch (e) {}
}

function recordHistory(type, description, snapshot) {
  operationHistory.unshift({
    id: Date.now(),
    time: new Date().toISOString(),
    type: type,
    description: description,
    snapshot: snapshot
  });
  if (operationHistory.length > HISTORY_MAX) operationHistory.length = HISTORY_MAX;
  saveHistory();
}

function showHistoryMenu(x, y) {
  var menu = document.getElementById('historyContextMenu');
  if (!menu) return;

  var html = '<div class="history-header">操作历史</div>';
  if (operationHistory.length === 0) {
    html += '<div class="history-empty">暂无操作记录<br><small>添加或删除任务后会自动记录</small></div>';
  } else {
    operationHistory.forEach(function(entry, index) {
      var time = new Date(entry.time);
      var timeStr = (time.getMonth() + 1) + '/' + time.getDate() + ' ' +
        ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2);
      html += '<div class="history-item" onclick="confirmRevert(' + index + ')">' +
        '<div class="history-left">' +
          '<div class="history-desc">' + escapeHtml(entry.description) + '</div>' +
          '<div class="history-meta">' + timeStr + '</div>' +
        '</div>' +
        '<span class="history-badge history-badge-' + entry.type + '">' + getTypeLabel(entry.type) + '</span>' +
      '</div>';
    });
  }
  menu.innerHTML = html;
  menu.style.display = 'block';

  var menuW = menu.offsetWidth;
  var menuH = menu.offsetHeight;
  var winW = window.innerWidth;
  var winH = window.innerHeight;

  if (x + menuW > winW) x = winW - menuW - 10;
  if (y + menuH > winH) y = winH - menuH - 10;
  if (x < 10) x = 10;
  if (y < 10) y = 10;

  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

var pendingRevertIndex = -1;

function confirmRevert(index) {
  if (index < 0 || index >= operationHistory.length) return;
  pendingRevertIndex = index;
  var entry = operationHistory[index];
  var dialog = document.getElementById('revertConfirmDialog');
  if (!dialog) return;
  document.getElementById('revertConfirmDesc').textContent = entry.description;
  dialog.style.display = 'flex';
}

function cancelRevert() {
  pendingRevertIndex = -1;
  var dialog = document.getElementById('revertConfirmDialog');
  if (dialog) dialog.style.display = 'none';
}

async function executeRevert() {
  var index = pendingRevertIndex;
  pendingRevertIndex = -1;
  var dialog = document.getElementById('revertConfirmDialog');
  if (dialog) dialog.style.display = 'none';
  if (index < 0 || index >= operationHistory.length) return;

  var entry = operationHistory[index];
  // 恢复到该操作之后的状态：取下一条更早记录的 snapshot
  // index=0 是最新操作，直接用它的 snapshot（操作前的状态=撤销最新操作）
  // index>0 时取下一条的 snapshot（即当前操作完成后、下一个操作之前的状态）
  var snapshotToRestore = index === 0 ? entry.snapshot : operationHistory[index - 1].snapshot;
  var preRevertSnapshot = JSON.parse(JSON.stringify(tasks));
  tasks = JSON.parse(JSON.stringify(snapshotToRestore));

  var ok = await saveTasksToServer();
  if (!ok) { loadData(); return; }

  // record this revert as a new history entry (don't delete old ones)
  recordHistory('edit', '回退: ' + entry.description, preRevertSnapshot);

  hideHistoryMenu();
  renderCalendar();
  showRevertToast(entry.description);

  // pulse the calendar
  var cal = document.querySelector('.calendar');
  if (cal) {
    cal.style.transition = 'none';
    cal.style.boxShadow = '0 0 0 8px rgba(102,126,234,0.35)';
    cal.style.borderRadius = '12px';
    requestAnimationFrame(function() {
      cal.style.transition = 'box-shadow 0.5s ease-out';
      cal.style.boxShadow = 'none';
    });
  }
  var modalDateEl = document.getElementById('modalDate');
  if (modalDateEl.dataset.dateKey) renderTaskList(modalDateEl.dataset.dateKey);
}

var revertToastTimer = null;

function showRevertToast(description) {
  var existing = document.getElementById('revertToast');
  if (existing) existing.remove();
  if (revertToastTimer) clearTimeout(revertToastTimer);

  var toast = document.createElement('div');
  toast.id = 'revertToast';
  toast.textContent = '已回退: ' + description;
  toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2000;' +
    'background:#1c1f2a;color:#e6edf3;padding:10px 24px;border-radius:20px;font-size:0.9em;' +
    'box-shadow:0 4px 20px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.3s,transform 0.3s;' +
    'transform:translateX(-50%) translateY(-10px);pointer-events:none;';
  document.body.appendChild(toast);

  requestAnimationFrame(function() {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  revertToastTimer = setTimeout(function() {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-10px)';
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300);
  }, 2000);
}

function hideHistoryMenu() {
  var menu = document.getElementById('historyContextMenu');
  if (menu) menu.style.display = 'none';
}

function getTypeLabel(type) {
  switch (type) {
    case 'add': return '添加';
    case 'delete': return '删除';
    case 'batch-delete': return '批量删';
    case 'edit': return '编辑';
    default: return '';
  }
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', function() {
  if (!checkAuth()) return;

  currentYear = new Date().getFullYear();
  currentMonth = new Date().getMonth();

  if (document.body.dataset.page !== 'mobile') {
    setupEventListeners();
  }
  loadHistory();
  loadData();
});

function setupEventListeners() {
  document.getElementById('prevMonth').addEventListener('click', function() {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
  });

  document.getElementById('nextMonth').addEventListener('click', function() {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar();
  });

  document.querySelector('#taskModal .close').addEventListener('click', closeModal);
  document.querySelector('#taskDetailModal .close').addEventListener('click', closeTaskDetailModal);
  document.querySelector('#editTaskModal .close').addEventListener('click', closeEditTaskModal);

  document.getElementById('settingsBtn').addEventListener('click', openSettingsPage);
  document.getElementById('settingsBackBtn').addEventListener('click', closeSettingsPage);
  document.getElementById('settingsSave').addEventListener('click', saveSettings);
  document.getElementById('settingsReset').addEventListener('click', resetSettings);
  document.getElementById('settingsAddInterval').addEventListener('click', addInterval);
  document.getElementById('settingsLogoutBtn').addEventListener('click', function() {
    try { localStorage.removeItem('mcs_cache_' + getUserId()); } catch (e) {}
    try { localStorage.removeItem('mcs_history_' + getUserId()); } catch (e) {}
    localStorage.removeItem('user');
    window.location.href = '/login.html';
  });

  document.querySelectorAll('.settings-sidebar .menu-item').forEach(function(item) {
    item.addEventListener('click', function() {
      document.querySelectorAll('.settings-sidebar .menu-item').forEach(function(m) { m.classList.remove('active'); });
      item.classList.add('active');
      var panelId = item.dataset.panel;
      document.querySelectorAll('.settings-panel').forEach(function(p) { p.style.display = 'none'; });
      document.getElementById('panel-' + panelId).style.display = 'block';
      if (panelId === 'batchDelete') initBatchDeletePanel();
    });
  });

  document.getElementById('addTask').addEventListener('click', addTask);
  document.getElementById('saveTaskEdit').addEventListener('click', saveTaskEdit);
  document.getElementById('cancelTaskEdit').addEventListener('click', closeEditTaskModal);

  document.getElementById('confirmBatchDelete').addEventListener('click', executeBatchDelete);
  document.getElementById('batchDeleteYear').addEventListener('change', updateBatchDeleteInfo);
  document.getElementById('batchDeleteMonth').addEventListener('change', updateBatchDeleteInfo);

  document.getElementById('taskInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addTask(); }
  });

  document.getElementById('addTaskImage').addEventListener('click', function() {
    document.getElementById('taskImageInput').click();
  });
  document.getElementById('taskImageInput').addEventListener('change', function(e) {
    if (e.target.files.length > 0) {
      addTaskImages(Array.from(e.target.files));
      e.target.value = '';
    }
  });

  document.getElementById('editTaskInput').addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveTaskEdit(); }
  });

  document.getElementById('calendarDays').addEventListener('contextmenu', function(e) {
    e.preventDefault();
    showHistoryMenu(e.clientX, e.clientY);
  });

  var historyBtn = document.getElementById('historyBtn');
  if (historyBtn) {
    historyBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var rect = historyBtn.getBoundingClientRect();
      showHistoryMenu(rect.left, rect.bottom + 4);
    });
  }

  // image viewer
  var viewer = document.getElementById('imgViewer');
  if (viewer) {
    document.getElementById('imgViewerClose').addEventListener('click', closeImageViewer);
    viewer.addEventListener('click', function(e) { if (e.target === viewer) closeImageViewer(); });
  }

  window.addEventListener('click', function(e) {
    var menu = document.getElementById('historyContextMenu');
    if (menu && menu.style.display === 'block' && !menu.contains(e.target) && e.target !== historyBtn) {
      hideHistoryMenu();
    }
    var dialog = document.getElementById('revertConfirmDialog');
    if (dialog && dialog.style.display === 'flex' && e.target === dialog) {
      cancelRevert();
    }
    if (e.target === document.getElementById('taskModal')) closeModal();
    if (e.target === document.getElementById('taskDetailModal')) closeTaskDetailModal();
    if (e.target === document.getElementById('editTaskModal')) closeEditTaskModal();
  });
}

// ===== 数据加载 =====
async function loadData() {
  var userId = getUserId();
  var cacheKey = 'mcs_cache_' + userId;

  // 先从缓存加载，立即渲染
  try {
    var cached = JSON.parse(localStorage.getItem(cacheKey));
    if (cached && cached.tasks) {
      tasks = cached.tasks;
      REVIEW_INTERVALS = cached.intervals || DEFAULT_INTERVALS.slice();
      if (REVIEW_INTERVALS.length < DEFAULT_INTERVALS.length) {
        REVIEW_INTERVALS = DEFAULT_INTERVALS.slice();
      }
      if (document.body.dataset.page !== 'mobile') renderCalendar();
    }
  } catch (e) {}

  // 并行从服务器加载
  var configPromise = fetch('/api/config?userId=' + encodeURIComponent(userId))
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });

  var tasksPromise = fetch('/api/tasks?userId=' + encodeURIComponent(userId))
    .then(function(r) { return r.ok ? r.json() : null; })
    .catch(function() { return null; });

  var results = await Promise.all([configPromise, tasksPromise]);
  var serverConfig = results[0];
  var serverTasks = results[1];

  var needRerender = false;

  if (serverConfig && serverConfig.intervals) {
    REVIEW_INTERVALS = serverConfig.intervals;
    if (REVIEW_INTERVALS.length < DEFAULT_INTERVALS.length) {
      REVIEW_INTERVALS = DEFAULT_INTERVALS.slice();
    }
    needRerender = true;
  } else if (!REVIEW_INTERVALS || REVIEW_INTERVALS.length === 0) {
    REVIEW_INTERVALS = DEFAULT_INTERVALS.slice();
  }

  if (serverTasks) {
    tasks = serverTasks;
    needRerender = true;
  } else if (!tasks || Object.keys(tasks).length === 0) {
    tasks = {};
  }

  // 更新缓存
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ tasks: tasks, intervals: REVIEW_INTERVALS }));
  } catch (e) {}

  if (document.body.dataset.page !== 'mobile') {
    if (needRerender || (document.getElementById('calendarDays') && !document.getElementById('calendarDays').children.length)) {
      renderCalendar();
    }
  }
  window.dispatchEvent(new CustomEvent('dataready'));
}

function updateCache() {
  try {
    var cacheKey = 'mcs_cache_' + getUserId();
    localStorage.setItem(cacheKey, JSON.stringify({ tasks: tasks, intervals: REVIEW_INTERVALS }));
  } catch (e) {}
}

async function saveTasksToServer() {
  var userId = getUserId();
  var errMsg = '';
  try {
    var res = await fetch('/api/tasks?userId=' + encodeURIComponent(userId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: tasks }),
    });
    if (res.ok) {
      updateCache();
      return true;
    }
    var text = await res.text();
    try { var j = JSON.parse(text); errMsg = j.error || text; } catch (_) { errMsg = text; }
  } catch (e) { errMsg = e.message || String(e); }
  window._lastSaveError = errMsg;
  return false;
}

async function saveConfigToServer(arr) {
  if (!arr || arr.length < DEFAULT_INTERVALS.length) {
    arr = DEFAULT_INTERVALS.slice();
    REVIEW_INTERVALS = arr;
  }
  var userId = getUserId();
  try {
    var res = await fetch('/api/config?userId=' + encodeURIComponent(userId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervals: arr }),
    });
    if (res.ok) {
      updateCache();
      return true;
    }
  } catch (e) {}
  return false;
}

// ===== 图片处理（base64 直接存储） =====
function addTaskImages(files) {
  newTaskImages.push.apply(newTaskImages, files);
  if (newTaskImages.length > 9) newTaskImages = newTaskImages.slice(0, 9);
  renderTaskImagePreviews();
}

function removeTaskImage(index) {
  newTaskImages.splice(index, 1);
  renderTaskImagePreviews();
}

function openImageViewer(src) {
  document.getElementById('imgViewerImg').src = src;
  document.getElementById('imgViewer').style.display = 'flex';
}
function closeImageViewer() {
  document.getElementById('imgViewer').style.display = 'none';
  document.getElementById('imgViewerImg').src = '';
}

function renderTaskImagePreviews() {
  var container = document.getElementById('taskImagePreviews');
  if (newTaskImages.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = newTaskImages.map(function(file, i) {
    return '<div class="task-image-preview">' +
      '<img src="' + URL.createObjectURL(file) + '" alt="" onclick="openImageViewer(this.src)">' +
      '<button class="img-remove-btn" onclick="removeTaskImage(' + i + ')" title="移除">&times;</button>' +
      '</div>';
  }).join('');
}

function resetTaskImages() {
  newTaskImages = [];
  renderTaskImagePreviews();
}

// 将 File 数组转为 base64 数组（带压缩，最大宽高 1024px，JPEG 质量 0.7）
function filesToBase64(files) {
  return Promise.all(files.map(function(f) { return compressAndEncode(f); }));
}

function compressAndEncode(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() {
      var img = new Image();
      img.onload = function() {
        var maxDim = 1024;
        var w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = function() { reject(new Error('图片加载失败')); };
      img.src = reader.result;
    };
    reader.onerror = function() { reject(reader.error); };
    reader.readAsDataURL(file);
  });
}

function renderDetailImages(images) {
  if (!images || images.length === 0) return '';
  return '<div class="task-detail-images">' +
    images.map(function(img) {
      return '<img src="' + img + '" alt="" onclick="openImageViewer(this.src)">';
    }).join('') +
    '</div>';
}

function renderTaskListThumbs(images) {
  if (!images || images.length === 0) return '';
  var maxShow = 4;
  var show = images.slice(0, maxShow);
  var extra = images.length > maxShow ? '<div class="tl-thumb-more">+' + (images.length - maxShow) + '</div>' : '';
  return '<div class="tl-thumbs">' +
    show.map(function(img) { return '<div class="tl-thumb"><img src="' + img + '" alt=""></div>'; }).join('') +
    extra + '</div>';
}

function renderCalendarThumbs(images) {
  if (!images || images.length === 0) return '';
  var maxShow = 3;
  var show = images.slice(0, maxShow);
  var extra = images.length > maxShow ? '<span class="cal-thumb-more">+' + (images.length - maxShow) + '</span>' : '';
  return '<span class="cal-thumbs">' +
    show.map(function(img) { return '<span class="cal-thumb"><img src="' + img + '" alt=""></span>'; }).join('') +
    extra + '</span>';
}

// ===== 日历渲染 =====
function renderCalendar() {
  var monthNames = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
  document.getElementById('currentMonth').textContent = currentYear + '年 ' + monthNames[currentMonth];

  var firstDay = new Date(currentYear, currentMonth, 1).getDay();
  var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  var daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();
  var calendarDays = document.getElementById('calendarDays');
  calendarDays.innerHTML = '';

  var today = new Date();
  var isCurrentMonth = today.getFullYear() === currentYear && today.getMonth() === currentMonth;

  for (var i = firstDay - 1; i >= 0; i--) {
    var day = daysInPrevMonth - i;
    var prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    var prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    calendarDays.appendChild(createDayElement(day, prevYear, prevMonth, true));
  }

  for (var d = 1; d <= daysInMonth; d++) {
    var isToday = isCurrentMonth && d === today.getDate();
    calendarDays.appendChild(createDayElement(d, currentYear, currentMonth, false, isToday));
  }

  var totalCells = calendarDays.children.length;
  var remaining = 42 - totalCells;
  var nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
  var nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;

  for (var nd = 1; nd <= remaining; nd++) {
    calendarDays.appendChild(createDayElement(nd, nextYear, nextMonth, true));
  }
}

function createDayElement(day, year, month, isOtherMonth, isToday) {
  var dayEl = document.createElement('div');
  dayEl.className = 'day';
  if (isOtherMonth) dayEl.classList.add('other-month');
  if (isToday) dayEl.classList.add('today');

  var dateKey = year + '-' + pad(month + 1) + '-' + pad(day);
  var displayDate = year + '年' + (month + 1) + '月' + day + '日';

  dayEl.innerHTML = '<div class="day-number">' + day + '</div>';

  var dayTasks = tasks[dateKey] || [];
  if (dayTasks.length > 0) {
    dayEl.classList.add('has-tasks');
    var countEl = document.createElement('div');
    countEl.className = 'task-count';
    countEl.textContent = dayTasks.length;
    dayEl.appendChild(countEl);

    var previewWrap = document.createElement('div');
    previewWrap.className = 'task-preview-list';
    var maxShow = 5;
    var showCount = Math.min(dayTasks.length, maxShow);

    for (var i = 0; i < showCount; i++) {
      var item = document.createElement('div');
      item.className = 'task-preview-item' + (dayTasks[i].isReview ? ' review' : '');
      item.innerHTML = '<span>' + escapeHtml(getCalendarPreview(dayTasks[i].text)) + '</span>' + renderCalendarThumbs(dayTasks[i].images);
      item.title = dayTasks[i].text;
      (function(task, dd, dk, idx) {
        item.addEventListener('click', function(e) {
          e.stopPropagation();
          openTaskDetail(task, dd, dk, idx);
        });
      })(dayTasks[i], displayDate, dateKey, i);
      previewWrap.appendChild(item);
    }

    if (dayTasks.length > maxShow) {
      var more = document.createElement('div');
      more.className = 'task-preview-more';
      more.textContent = '...还有' + (dayTasks.length - maxShow) + '个';
      previewWrap.appendChild(more);
    }

    dayEl.appendChild(previewWrap);
  }

  dayEl.addEventListener('click', function() { openModal(dateKey, year, month, day); });
  return dayEl;
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function getCalendarPreview(text) {
  return text.length > 9 ? text.slice(0, 9) + '...' : text;
}

function formatDateKey(dateKey) {
  var parts = dateKey.split('-');
  return parts[0] + '年' + parseInt(parts[1]) + '月' + parseInt(parts[2]) + '日';
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== 模态框处理 =====
function openModal(dateKey, year, month, day) {
  document.getElementById('modalDate').textContent = year + '年' + (month + 1) + '月' + day + '日';
  document.getElementById('modalDate').dataset.dateKey = dateKey;
  renderTaskList(dateKey);
  resetTaskComposer();
  document.getElementById('taskModal').style.display = 'block';
}

function closeModal() {
  document.getElementById('taskModal').style.display = 'none';
  resetTaskComposer();
  resetTaskImages();
}

function resetTaskComposer() {
  document.getElementById('taskInput').value = '';
  document.getElementById('syncReviewTasks').checked = false;
  resetTaskImages();
}

function renderTaskList(dateKey) {
  var taskList = document.getElementById('taskList');
  var dayTasks = tasks[dateKey] || [];

  if (dayTasks.length === 0) {
    taskList.innerHTML = '<p style="text-align:center;color:#999;">暂无任务</p>';
    return;
  }

  taskList.innerHTML = dayTasks.map(function(task, index) {
    var linkedCount = countLinkedReviews(dateKey, index, task);
    return '<div class="task-item' + (task.isReview ? ' review' : '') + '">' +
      '<div class="task-content">' +
        '<div class="task-text">' + escapeHtml(task.text) + '</div>' +
        (task.isReview
          ? '<div class="task-meta">复习任务 (源自 ' + task.originalDate + ')</div>'
          : '<div class="task-meta">原始任务 (' + dateKey + ')</div>') +
        renderTaskListThumbs(task.images) +
      '</div>' +
      '<div class="task-actions" id="actions-' + dateKey + '-' + index + '">' +
        '<button class="edit-btn" onclick="editTask(\'' + dateKey + '\',' + index + ')">编辑</button>' +
        '<button class="task-del-btn" onclick="handleDeleteClick(\'' + dateKey + '\',' + index + ',' + linkedCount + ')" title="删除">&times;</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ===== 任务详情 =====
function openTaskDetail(task, displayDate, dateKey, index) {
  var title = document.getElementById('detailModalTitle');
  var body = document.getElementById('taskDetailBody');
  var meta = task.isReview
    ? '复习日期：' + displayDate + '｜源任务日期：' + formatDateKey(task.originalDate)
    : '任务日期：' + displayDate;

  detailTaskRef = { dateKey: dateKey, index: index };
  detailViewMeta = meta;
  title.textContent = task.isReview ? '复习任务详情' : '任务详情';
  body.innerHTML =
    '<div class="task-detail-content">' +
      '<div class="task-detail-meta">' + escapeHtml(meta) + '</div>' +
      '<div class="task-detail-text">' + escapeHtml(task.text) + '</div>' +
      renderDetailImages(task.images) +
    '</div>' +
    '<div class="detail-modal-actions">' +
      '<button id="editFromDetail" class="edit-btn">编辑</button>' +
    '</div>';
  document.getElementById('editFromDetail').addEventListener('click', editFromDetail);
  document.getElementById('taskDetailModal').style.display = 'block';
}

function closeTaskDetailModal() {
  document.getElementById('taskDetailModal').style.display = 'none';
  document.getElementById('taskDetailBody').innerHTML = '';
  detailTaskRef = null;
  detailViewMeta = '';
}

function editFromDetail() {
  if (!detailTaskRef) return;
  var dateKey = detailTaskRef.dateKey;
  var index = detailTaskRef.index;
  var task = tasks[dateKey] && tasks[dateKey][index];
  if (!task) return;

  detailEditImages = {
    existing: task.images ? task.images.slice() : [],
    newFiles: [],
    removed: []
  };

  var linkedCount = countLinkedReviews(dateKey, index, task);
  var title = document.getElementById('detailModalTitle');
  var body = document.getElementById('taskDetailBody');
  title.textContent = '编辑任务';
  body.innerHTML =
    '<div class="task-detail-content">' +
      '<div class="task-detail-meta">' + escapeHtml(detailViewMeta) + '</div>' +
      '<textarea id="detailEditInput" class="detail-edit-textarea" maxlength="500" placeholder="输入任务内容（最多500字）">' + escapeHtml(task.text) + '</textarea>' +
      (linkedCount > 0
        ? '<label class="edit-sync-toggle"><input id="detailSyncReviews" type="checkbox" checked><span>同步修改关联的复习任务</span></label>'
        : '') +
    '</div>' +
    '<div id="detailEditImageArea" class="edit-task-image-area"></div>' +
    '<div class="edit-modal-actions">' +
      '<button id="saveDetailEdit" class="edit-btn">保存</button>' +
      '<button id="cancelDetailEdit" class="delete-btn">取消</button>' +
    '</div>';
  document.getElementById('saveDetailEdit').addEventListener('click', saveDetailEdit);
  document.getElementById('cancelDetailEdit').addEventListener('click', cancelDetailEdit);
  renderEditTaskImages('detailEditImageArea', 'detailImageInput');

  var input = document.getElementById('detailEditInput');
  requestAnimationFrame(function() {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function saveDetailEdit() {
  if (!detailTaskRef) return;
  var dateKey = detailTaskRef.dateKey;
  var index = detailTaskRef.index;
  var task = tasks[dateKey] && tasks[dateKey][index];
  if (!task) return;

  var oldText = task.text;
  var trimmed = document.getElementById('detailEditInput').value.trim();
  if (!trimmed && detailEditImages.existing.length === 0) return;
  if (trimmed.length > 500) trimmed = trimmed.slice(0, 500);

  var applyChanges = async function() {
    var snapshot = JSON.parse(JSON.stringify(tasks));

    if (trimmed !== oldText) {
      tasks[dateKey][index].text = trimmed;
      var syncCheckbox = document.getElementById('detailSyncReviews');
      if (syncCheckbox && syncCheckbox.checked) {
        syncReviewTexts(task, dateKey, oldText, trimmed);
      }
    }

    var finalExisting = detailEditImages.existing;
    tasks[dateKey][index].images = finalExisting.length > 0 ? finalExisting.slice() : undefined;

    var ok = await saveTasksToServer();
    if (!ok) { tasks = snapshot; return; }

    recordHistory('edit', '编辑任务: ' + (trimmed || '(图片)').slice(0, 20), snapshot);

    renderCalendar();
    closeTaskDetailModal();
    var modalDateEl = document.getElementById('modalDate');
    if (modalDateEl.dataset.dateKey) renderTaskList(modalDateEl.dataset.dateKey);
  };

  if (detailEditImages.newFiles.length > 0) {
    filesToBase64(detailEditImages.newFiles).then(function(filenames) {
      detailEditImages.existing.push.apply(detailEditImages.existing, filenames);
      applyChanges();
    });
  } else {
    applyChanges();
  }
}

function cancelDetailEdit() {
  if (!detailTaskRef) return;
  detailEditImages = { existing: [], newFiles: [], removed: [] };
  var dateKey = detailTaskRef.dateKey;
  var index = detailTaskRef.index;
  var task = tasks[dateKey] && tasks[dateKey][index];
  if (!task) { closeTaskDetailModal(); return; }

  var title = document.getElementById('detailModalTitle');
  var body = document.getElementById('taskDetailBody');
  title.textContent = task.isReview ? '复习任务详情' : '任务详情';
  body.innerHTML =
    '<div class="task-detail-content">' +
      '<div class="task-detail-meta">' + escapeHtml(detailViewMeta) + '</div>' +
      '<div class="task-detail-text">' + escapeHtml(task.text) + '</div>' +
      renderDetailImages(task.images) +
    '</div>' +
    '<div class="detail-modal-actions">' +
      '<button id="editFromDetail" class="edit-btn">编辑</button>' +
    '</div>';
  document.getElementById('editFromDetail').addEventListener('click', editFromDetail);
}

// ===== 任务编辑 =====
function editTask(dateKey, index) {
  var task = tasks[dateKey] && tasks[dateKey][index];
  if (!task) return;

  editingTask = { dateKey: dateKey, index: index };
  document.getElementById('editModalTitle').textContent = '编辑任务 - ' + formatDateKey(dateKey);

  var input = document.getElementById('editTaskInput');
  input.value = task.text;

  var syncToggle = document.getElementById('editSyncToggle');
  var syncCheckbox = document.getElementById('editSyncReviews');
  if (countLinkedReviews(dateKey, index, task) > 0) {
    syncToggle.style.display = 'flex';
    syncCheckbox.checked = true;
  } else {
    syncToggle.style.display = 'none';
    syncCheckbox.checked = false;
  }

  detailEditImages = {
    existing: task.images ? task.images.slice() : [],
    newFiles: [],
    removed: []
  };
  renderEditTaskImages('editTaskImageArea', 'editImageInput');
  document.getElementById('editTaskModal').style.display = 'block';

  requestAnimationFrame(function() {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function renderEditTaskImages(containerId, inputId) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var existing = detailEditImages.existing;
  var newFiles = detailEditImages.newFiles;
  var total = existing.length + newFiles.length;
  var html = '';

  if (total > 0) {
    html += '<div class="task-image-previews">';
    existing.forEach(function(filename, i) {
      html += '<div class="task-image-preview">' +
        '<img src="' + filename + '" alt="" onclick="openImageViewer(this.src)">' +
        '<button class="img-remove-btn" onclick="removeEditExistingImage(' + i + ',\'' + containerId + '\',\'' + inputId + '\')" title="移除">&times;</button>' +
        '</div>';
    });
    newFiles.forEach(function(file, i) {
      html += '<div class="task-image-preview">' +
        '<img src="' + URL.createObjectURL(file) + '" alt="" onclick="openImageViewer(this.src)">' +
        '<button class="img-remove-btn" onclick="removeEditNewImage(' + i + ',\'' + containerId + '\',\'' + inputId + '\')" title="移除">&times;</button>' +
        '</div>';
    });
    html += '</div>';
  }
  html += '<button type="button" class="add-image-btn" onclick="addEditImage(\'' + inputId + '\')">+ 添加图片</button>';
  html += '<input id="' + inputId + '" type="file" accept="image/*" multiple hidden onchange="onEditImageSelect(event,\'' + containerId + '\',\'' + inputId + '\')">';
  container.innerHTML = html;
}

function addEditImage(inputId) { document.getElementById(inputId).click(); }

function onEditImageSelect(e, containerId, inputId) {
  if (e.target.files.length > 0) {
    detailEditImages.newFiles.push.apply(detailEditImages.newFiles, Array.from(e.target.files));
    var limit = 9 - detailEditImages.existing.length;
    if (detailEditImages.newFiles.length > Math.max(limit, 0)) {
      detailEditImages.newFiles = detailEditImages.newFiles.slice(0, Math.max(limit, 0));
    }
    renderEditTaskImages(containerId, inputId);
  }
  e.target.value = '';
}

function removeEditExistingImage(index, containerId, inputId) {
  detailEditImages.existing.splice(index, 1);
  renderEditTaskImages(containerId, inputId);
}

function removeEditNewImage(index, containerId, inputId) {
  detailEditImages.newFiles.splice(index, 1);
  renderEditTaskImages(containerId, inputId);
}

function closeEditTaskModal() {
  document.getElementById('editTaskModal').style.display = 'none';
  document.getElementById('editTaskInput').value = '';
  editingTask = null;
}

function saveTaskEdit() {
  if (!editingTask) return;
  var dateKey = editingTask.dateKey;
  var index = editingTask.index;
  var task = tasks[dateKey] && tasks[dateKey][index];
  if (!task) { closeEditTaskModal(); return; }

  var oldText = task.text;
  var trimmed = document.getElementById('editTaskInput').value.trim();
  if (trimmed.length > 500) trimmed = trimmed.slice(0, 500);

  var applyChanges = async function() {
    var snapshot = JSON.parse(JSON.stringify(tasks));

    if (trimmed && trimmed !== oldText) {
      tasks[dateKey][index].text = trimmed;
      var syncCb = document.getElementById('editSyncReviews');
      if (syncCb && syncCb.checked) {
        syncReviewTexts(task, dateKey, oldText, trimmed);
      }
    }

    var finalExisting = detailEditImages.existing;
    tasks[dateKey][index].images = finalExisting.length > 0 ? finalExisting.slice() : undefined;

    var ok = await saveTasksToServer();
    if (!ok) { tasks = snapshot; return; }

    recordHistory('edit', '编辑任务: ' + (trimmed || '(图片)').slice(0, 20), snapshot);

    renderTaskList(dateKey);
    renderCalendar();
    closeEditTaskModal();
  };

  if (detailEditImages.newFiles.length > 0) {
    filesToBase64(detailEditImages.newFiles).then(function(filenames) {
      detailEditImages.existing.push.apply(detailEditImages.existing, filenames);
      applyChanges();
    });
  } else {
    applyChanges();
  }
}

function syncReviewTexts(task, dateKey, oldText, newText) {
  if (task.isReview) {
    var src = task.originalDate;
    Object.keys(tasks).forEach(function(key) {
      tasks[key].forEach(function(t) {
        if (key === src && !t.isReview && t.text === oldText) t.text = newText;
        if (t.isReview && t.originalDate === src && t.text === oldText && !(key === dateKey && t.text === newText)) t.text = newText;
      });
    });
  } else {
    Object.keys(tasks).forEach(function(key) {
      tasks[key].forEach(function(t) {
        if (t.isReview && t.originalDate === dateKey && t.text === oldText) t.text = newText;
      });
    });
  }
}

// ===== 添加任务 =====
var addTaskLock = false;

async function addTask() {
  if (addTaskLock) return;
  addTaskLock = true;

  var btn = document.getElementById('addTask');
  btn.classList.add('loading');
  btn.textContent = '添加中...';

  try {
    var input = document.getElementById('taskInput');
    var taskText = input.value.trim();
    if (taskText.length > 500) taskText = taskText.slice(0, 500);
    if (!taskText && newTaskImages.length === 0) { return; }

    var dateKey = document.getElementById('modalDate').dataset.dateKey;
    var syncReviewTasks = document.getElementById('syncReviewTasks').checked;

    if (!tasks[dateKey]) tasks[dateKey] = [];

    var filenames = await filesToBase64(newTaskImages);

    var snapshot = JSON.parse(JSON.stringify(tasks));

    tasks[dateKey].push({
      text: taskText,
      isReview: false,
      createdAt: new Date().toISOString(),
      images: filenames.length > 0 ? filenames : undefined
    });

    if (syncReviewTasks) {
      addReviewTasks(dateKey, taskText, filenames);
    }

    var ok = await saveTasksToServer();
    if (!ok) {
      tasks = snapshot;
      return;
    }

    recordHistory('add', '添加任务: ' + (taskText || '(图片)').slice(0, 20), snapshot);

    resetTaskComposer();
    resetTaskImages();
    renderTaskList(dateKey);
    renderCalendar();
  } finally {
    btn.classList.remove('loading');
    btn.textContent = '添加任务';
    addTaskLock = false;
  }
}

function addReviewTasks(originalDateKey, taskText, images) {
  var parts = originalDateKey.split('-');
  var originalDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));

  REVIEW_INTERVALS.forEach(function(interval) {
    var reviewDate = new Date(originalDate);
    reviewDate.setDate(reviewDate.getDate() + interval);
    var reviewDateKey = reviewDate.getFullYear() + '-' + pad(reviewDate.getMonth() + 1) + '-' + pad(reviewDate.getDate());

    if (!tasks[reviewDateKey]) tasks[reviewDateKey] = [];

    tasks[reviewDateKey].push({
      text: taskText,
      isReview: true,
      originalDate: originalDateKey,
      createdAt: new Date().toISOString(),
      images: images && images.length > 0 ? images.slice() : undefined
    });
  });
}

// ===== 删除任务 =====
function countLinkedReviews(dateKey, index, task) {
  if (task.isReview) {
    var count = 0;
    var src = task.originalDate;
    var txt = task.text;
    Object.keys(tasks).forEach(function(key) {
      tasks[key].forEach(function(item, itemIndex) {
        if (key === dateKey && itemIndex === index) return;
        var sameSource = item.isReview && item.originalDate === src && item.text === txt;
        var isSource = key === src && !item.isReview && item.text === txt;
        if (sameSource || isSource) count++;
      });
    });
    return count;
  }
  var count = 0;
  Object.keys(tasks).forEach(function(key) {
    tasks[key].forEach(function(item, itemIndex) {
      if (item.isReview && item.originalDate === dateKey && item.text === task.text && !(key === dateKey && itemIndex === index)) {
        count++;
      }
    });
  });
  return count;
}

function handleDeleteClick(dateKey, index, linkedCount) {
  if (linkedCount > 0) {
    showDeleteChoice(dateKey, index, linkedCount);
  } else {
    deleteTaskSingle(dateKey, index);
  }
}

function showDeleteChoice(dateKey, index, linkedCount) {
  var actionsEl = document.getElementById('actions-' + dateKey + '-' + index);
  if (!actionsEl) return;
  actionsEl.innerHTML =
    '<button class="delete-btn" onclick="deleteTaskSingle(\'' + dateKey + '\',' + index + ')">仅删此项</button>' +
    '<button class="delete-btn" style="background:#d83a52;color:#fff" onclick="deleteTaskLinked(\'' + dateKey + '\',' + index + ')">删除全部关联(' + (linkedCount + 1) + '条)</button>';
}

async function deleteTaskSingle(dateKey, index) {
  var task = tasks[dateKey] && tasks[dateKey][index];
  if (!task) return;

  if (editingTask && editingTask.dateKey === dateKey && editingTask.index === index) closeEditTaskModal();

  var snapshot = JSON.parse(JSON.stringify(tasks));

  tasks[dateKey].splice(index, 1);
  if (tasks[dateKey].length === 0) delete tasks[dateKey];

  var ok = await saveTasksToServer();
  if (!ok) { tasks = snapshot; return; }

  recordHistory('delete', '删除任务: ' + (task.text || '(图片)').slice(0, 20), snapshot);

  renderTaskList(document.getElementById('modalDate').dataset.dateKey);
  renderCalendar();
}

async function deleteTaskLinked(dateKey, index) {
  var actionItems = createDeleteAction(dateKey, index);
  if (!actionItems || actionItems.length === 0) return;

  if (editingTask && editingTask.dateKey === dateKey && editingTask.index === index) closeEditTaskModal();

  var snapshot = JSON.parse(JSON.stringify(tasks));

  applyDeleteAction(actionItems);

  var ok = await saveTasksToServer();
  if (!ok) { tasks = snapshot; return; }

  recordHistory('delete', '删除 ' + actionItems.length + ' 条关联任务', snapshot);

  renderTaskList(document.getElementById('modalDate').dataset.dateKey);
  renderCalendar();
}

function cloneTask(t) {
  return {
    text: t.text,
    isReview: t.isReview || false,
    originalDate: t.originalDate || null,
    createdAt: t.createdAt,
    images: t.images ? t.images.slice() : undefined
  };
}

function createDeleteAction(dateKey, index) {
  var task = tasks[dateKey] && tasks[dateKey][index];
  if (!task) return null;

  var deletedItems = [];
  var taskText = task.text;
  var sourceKey = task.isReview ? task.originalDate : dateKey;

  Object.keys(tasks).forEach(function(key) {
    tasks[key].forEach(function(item, itemIndex) {
      var isSource = key === sourceKey && !item.isReview && item.text === taskText;
      var isReview = item.isReview && item.originalDate === sourceKey && item.text === taskText;
      if (isSource || isReview) {
        deletedItems.push({ dateKey: key, index: itemIndex, task: cloneTask(item) });
      }
    });
  });

  deletedItems.sort(function(a, b) {
    if (a.dateKey === b.dateKey) return b.index - a.index;
    return a.dateKey.localeCompare(b.dateKey);
  });

  return deletedItems;
}

function applyDeleteAction(actionItems) {
  actionItems.forEach(function(item) {
    if (!tasks[item.dateKey]) return;
    tasks[item.dateKey].splice(item.index, 1);
    if (tasks[item.dateKey].length === 0) delete tasks[item.dateKey];
  });
}

// ===== 批量删除 =====
function initBatchDeletePanel() {
  var yearSelect = document.getElementById('batchDeleteYear');
  var monthSelect = document.getElementById('batchDeleteMonth');
  var monthNames = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];

  var years = {};
  Object.keys(tasks).forEach(function(key) {
    years[parseInt(key.split('-')[0])] = true;
  });
  var sortedYears = Object.keys(years).map(Number).sort(function(a, b) { return b - a; });
  if (sortedYears.length === 0) sortedYears = [new Date().getFullYear()];

  yearSelect.innerHTML = sortedYears.map(function(y) { return '<option value="' + y + '">' + y + '年</option>'; }).join('');
  monthSelect.innerHTML = '<option value="0">全部月份</option>' +
    monthNames.map(function(name, i) { return '<option value="' + (i + 1) + '">' + name + '</option>'; }).join('');

  monthSelect.value = currentMonth + 1;
  if (sortedYears.indexOf(currentYear) !== -1) yearSelect.value = currentYear;

  updateBatchDeleteInfo();
}

function updateBatchDeleteInfo() {
  var year = parseInt(document.getElementById('batchDeleteYear').value);
  var month = parseInt(document.getElementById('batchDeleteMonth').value);
  var prefix = month === 0 ? year + '-' : year + '-' + pad(month) + '-';
  var count = 0;
  Object.keys(tasks).forEach(function(key) {
    if (key.indexOf(prefix) === 0) count += tasks[key].length;
  });
  var scope = month === 0 ? year + '年全年' : year + '年' + month + '月';
  document.getElementById('batchDeleteInfo').textContent = count > 0 ? scope + '共有 ' + count + ' 条任务将被删除' : scope + '没有任务';
}

async function executeBatchDelete() {
  var year = parseInt(document.getElementById('batchDeleteYear').value);
  var month = parseInt(document.getElementById('batchDeleteMonth').value);
  var prefix = month === 0 ? year + '-' : year + '-' + pad(month) + '-';

  var keysToDelete = Object.keys(tasks).filter(function(key) { return key.indexOf(prefix) === 0; });
  if (keysToDelete.length === 0) return;

  var totalCount = 0;
  keysToDelete.forEach(function(key) { totalCount += (tasks[key] || []).length; });

  var scope = month === 0 ? year + '年全年' : year + '年' + month + '月';
  if (!confirm('确定删除 ' + scope + ' 共 ' + totalCount + ' 条任务？此操作不可撤回。')) return;

  var btn = document.getElementById('confirmBatchDelete');
  btn.disabled = true;
  btn.textContent = '删除中...';
  btn.style.opacity = '0.6';

  var snapshot = JSON.parse(JSON.stringify(tasks));

  keysToDelete.forEach(function(key) { delete tasks[key]; });

  var ok = await saveTasksToServer();
  if (!ok) {
    tasks = snapshot;
    btn.disabled = false;
    btn.textContent = '确认删除';
    btn.style.opacity = '';
    alert('删除失败，请重试');
    return;
  }

  recordHistory('batch-delete', '批量删除 ' + scope + ' ' + totalCount + '条', snapshot);

  btn.disabled = false;
  btn.textContent = '确认删除';
  btn.style.opacity = '';

  initBatchDeletePanel();
  renderCalendar();

  var modalDateEl = document.getElementById('modalDate');
  if (modalDateEl.dataset.dateKey && modalDateEl.dataset.dateKey.indexOf(prefix) === 0) {
    renderTaskList(modalDateEl.dataset.dateKey);
  }

  alert('已成功删除 ' + scope + ' 共 ' + totalCount + ' 条任务');
}

// ===== 设置 =====
function openSettingsPage() {
  renderIntervalsEditor();
  // 填充账号信息
  if (currentUser) {
    document.getElementById('settingsUsername').textContent = currentUser.username;
    document.getElementById('accountName').textContent = currentUser.username;
    document.getElementById('avatarLetter').textContent = (currentUser.username || '?')[0].toUpperCase();
  }
  document.getElementById('settingsPage').style.display = 'block';
}

function closeSettingsPage() { document.getElementById('settingsPage').style.display = 'none'; }

function renderIntervalsEditor() {
  var container = document.getElementById('intervalsEditor');
  var arr = REVIEW_INTERVALS.slice();
  var canDelete = arr.length > 5;
  container.innerHTML = arr.map(function(v, i) {
    return '<div class="interval-row">' +
      '<span class="interval-label">第 ' + (i + 1) + ' 次复习</span>' +
      '<input type="number" min="1" max="365" value="' + v + '">' +
      '<span>天后</span>' +
      '<button class="interval-del-btn' + (canDelete ? ' visible' : '') + '" title="删除">&times;</button>' +
      '</div>';
  }).join('');

  container.querySelectorAll('.interval-del-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var rows = container.querySelectorAll('.interval-row');
      if (rows.length <= 5) return;
      btn.closest('.interval-row').remove();
      refreshIntervalLabels();
      refreshDeleteButtons();
    });
  });
}

function addInterval() {
  var container = document.getElementById('intervalsEditor');
  var rows = container.querySelectorAll('.interval-row');
  var lastInput = rows.length > 0 ? rows[rows.length - 1].querySelector('input') : null;
  var nextVal = lastInput ? Math.min((parseInt(lastInput.value) || 1) * 2, 365) : 1;
  var idx = rows.length + 1;
  var row = document.createElement('div');
  row.className = 'interval-row';
  row.innerHTML =
    '<span class="interval-label">第 ' + idx + ' 次复习</span>' +
    '<input type="number" min="1" max="365" value="' + Math.min(nextVal, 365) + '">' +
    '<span>天后</span>' +
    '<button class="interval-del-btn visible" title="删除">&times;</button>';
  row.querySelector('.interval-del-btn').addEventListener('click', function() {
    var rows = container.querySelectorAll('.interval-row');
    if (rows.length <= 5) return;
    row.remove();
    refreshIntervalLabels();
    refreshDeleteButtons();
  });
  container.appendChild(row);
  refreshIntervalLabels();
  refreshDeleteButtons();
}

function refreshIntervalLabels() {
  var rows = document.querySelectorAll('#intervalsEditor .interval-row');
  rows.forEach(function(row, i) { row.querySelector('.interval-label').textContent = '第 ' + (i + 1) + ' 次复习'; });
}

function refreshDeleteButtons() {
  var rows = document.querySelectorAll('#intervalsEditor .interval-row');
  var canDelete = rows.length > 5;
  rows.forEach(function(row) {
    var btn = row.querySelector('.interval-del-btn');
    if (canDelete) btn.classList.add('visible');
    else btn.classList.remove('visible');
  });
}

async function saveSettings() {
  var inputs = document.querySelectorAll('#intervalsEditor input');
  var arr = [];
  inputs.forEach(function(inp) {
    var v = parseInt(inp.value) || 1;
    arr.push(Math.max(1, Math.min(365, v)));
  });
  arr.sort(function(a, b) { return a - b; });
  if (arr.length < DEFAULT_INTERVALS.length) arr = DEFAULT_INTERVALS.slice();
  var oldIntervals = REVIEW_INTERVALS;
  REVIEW_INTERVALS = arr;
  var ok = await saveConfigToServer(arr);
  if (!ok) { REVIEW_INTERVALS = oldIntervals; return; }
}

function resetSettings() {
  REVIEW_INTERVALS = DEFAULT_INTERVALS.slice();
  renderIntervalsEditor();
}
