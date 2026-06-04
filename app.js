// ===== 记忆曲线任务日历 - CloudBase 版本 =====

var DEFAULT_INTERVALS = [1, 3, 6, 13, 27];
var REVIEW_INTERVALS = DEFAULT_INTERVALS.slice();
var UNDO_TOAST_DURATION = 5000;

var currentUser = null;
var currentYear, currentMonth;
var tasks = {};
var editingTask = null;
var lastDeletedAction = null;
var undoToastTimer = null;
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
  window.location.href = '/login.html';
  return false;
}

function getUserId() {
  return currentUser ? currentUser.id : '';
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', function() {
  if (!checkAuth()) return;

  currentYear = new Date().getFullYear();
  currentMonth = new Date().getMonth();

  document.getElementById('userDisplay').textContent = currentUser.username;

  setupEventListeners();
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
  document.querySelector('#batchDeleteModal .close').addEventListener('click', closeBatchDeleteModal);

  document.getElementById('settingsBtn').addEventListener('click', openSettingsPage);
  document.getElementById('settingsBackBtn').addEventListener('click', closeSettingsPage);
  document.getElementById('settingsSave').addEventListener('click', saveSettings);
  document.getElementById('settingsReset').addEventListener('click', resetSettings);
  document.getElementById('settingsAddInterval').addEventListener('click', addInterval);
  document.getElementById('settingsLogoutBtn').addEventListener('click', function() {
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
    });
  });

  document.getElementById('addTask').addEventListener('click', addTask);
  document.getElementById('saveTaskEdit').addEventListener('click', saveTaskEdit);
  document.getElementById('cancelTaskEdit').addEventListener('click', closeEditTaskModal);
  document.getElementById('undoDelete').addEventListener('click', undoLastDelete);
  document.getElementById('dismissUndoToast').addEventListener('click', hideUndoToast);

  document.getElementById('batchDeleteBtn').addEventListener('click', openBatchDeleteModal);
  document.getElementById('confirmBatchDelete').addEventListener('click', executeBatchDelete);
  document.getElementById('cancelBatchDelete').addEventListener('click', closeBatchDeleteModal);
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

  window.addEventListener('click', function(e) {
    if (e.target === document.getElementById('taskModal')) closeModal();
    if (e.target === document.getElementById('taskDetailModal')) closeTaskDetailModal();
    if (e.target === document.getElementById('editTaskModal')) closeEditTaskModal();
    if (e.target === document.getElementById('batchDeleteModal')) closeBatchDeleteModal();
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
      renderCalendar();
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

  if (needRerender || !document.getElementById('calendarDays').children.length) {
    renderCalendar();
  }
}

function updateCache() {
  try {
    var cacheKey = 'mcs_cache_' + getUserId();
    localStorage.setItem(cacheKey, JSON.stringify({ tasks: tasks, intervals: REVIEW_INTERVALS }));
  } catch (e) {}
}

async function saveTasksToServer() {
  var userId = getUserId();
  updateCache();
  try {
    await fetch('/api/tasks?userId=' + encodeURIComponent(userId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: tasks }),
    });
  } catch (e) {}
}

async function saveConfigToServer(arr) {
  var userId = getUserId();
  updateCache();
  try {
    await fetch('/api/config?userId=' + encodeURIComponent(userId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervals: arr }),
    });
  } catch (e) {}
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

function renderTaskImagePreviews() {
  var container = document.getElementById('taskImagePreviews');
  if (newTaskImages.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = newTaskImages.map(function(file, i) {
    return '<div class="task-image-preview">' +
      '<img src="' + URL.createObjectURL(file) + '" alt="">' +
      '<button class="img-remove-btn" onclick="removeTaskImage(' + i + ')" title="移除">&times;</button>' +
      '</div>';
  }).join('');
}

function resetTaskImages() {
  newTaskImages = [];
  renderTaskImagePreviews();
}

// 将 File 数组转为 base64 数组
function filesToBase64(files) {
  return Promise.all(files.map(function(f) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result); };
      reader.onerror = function() { reject(reader.error); };
      reader.readAsDataURL(f);
    });
  }));
}

function renderDetailImages(images) {
  if (!images || images.length === 0) return '';
  return '<div class="task-detail-images">' +
    images.map(function(img) {
      return '<img src="' + img + '" alt="" onclick="this.classList.toggle(\'expanded\')">';
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
  if (!trimmed) return;
  if (trimmed.length > 500) trimmed = trimmed.slice(0, 500);

  var applyChanges = function() {
    if (trimmed !== oldText) {
      tasks[dateKey][index].text = trimmed;
      var syncCheckbox = document.getElementById('detailSyncReviews');
      if (syncCheckbox && syncCheckbox.checked) {
        syncReviewTexts(task, dateKey, oldText, trimmed);
      }
    }

    var finalExisting = detailEditImages.existing;
    tasks[dateKey][index].images = finalExisting.length > 0 ? finalExisting.slice() : undefined;

    saveTasksToServer();
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
        '<img src="' + filename + '" alt="">' +
        '<button class="img-remove-btn" onclick="removeEditExistingImage(' + i + ',\'' + containerId + '\',\'' + inputId + '\')" title="移除">&times;</button>' +
        '</div>';
    });
    newFiles.forEach(function(file, i) {
      html += '<div class="task-image-preview">' +
        '<img src="' + URL.createObjectURL(file) + '" alt="">' +
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

  var applyChanges = function() {
    if (trimmed && trimmed !== oldText) {
      tasks[dateKey][index].text = trimmed;
      var syncCb = document.getElementById('editSyncReviews');
      if (syncCb && syncCb.checked) {
        syncReviewTexts(task, dateKey, oldText, trimmed);
      }
    }

    var finalExisting = detailEditImages.existing;
    tasks[dateKey][index].images = finalExisting.length > 0 ? finalExisting.slice() : undefined;

    saveTasksToServer();
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
function addTask() {
  var input = document.getElementById('taskInput');
  var taskText = input.value.trim();
  if (taskText.length > 500) taskText = taskText.slice(0, 500);
  if (!taskText && newTaskImages.length === 0) return;

  var dateKey = document.getElementById('modalDate').dataset.dateKey;
  var syncReviewTasks = document.getElementById('syncReviewTasks').checked;

  if (!tasks[dateKey]) tasks[dateKey] = [];

  filesToBase64(newTaskImages).then(function(filenames) {
    tasks[dateKey].push({
      text: taskText || '(图片)',
      isReview: false,
      createdAt: new Date().toISOString(),
      images: filenames.length > 0 ? filenames : undefined
    });

    if (syncReviewTasks) {
      addReviewTasks(dateKey, taskText || '(图片)', filenames);
    }

    saveTasksToServer();
    resetTaskComposer();
    resetTaskImages();
    renderTaskList(dateKey);
    renderCalendar();
  });
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

function deleteTaskSingle(dateKey, index) {
  var task = tasks[dateKey] && tasks[dateKey][index];
  if (!task) return;

  if (editingTask && editingTask.dateKey === dateKey && editingTask.index === index) closeEditTaskModal();

  lastDeletedAction = { items: [{ dateKey: dateKey, index: index, task: cloneTask(task) }] };

  tasks[dateKey].splice(index, 1);
  if (tasks[dateKey].length === 0) delete tasks[dateKey];

  saveTasksToServer();
  renderTaskList(document.getElementById('modalDate').dataset.dateKey);
  renderCalendar();
  showUndoToast(lastDeletedAction);
}

function deleteTaskLinked(dateKey, index) {
  var actionItems = createDeleteAction(dateKey, index);
  if (!actionItems || actionItems.length === 0) return;

  if (editingTask && editingTask.dateKey === dateKey && editingTask.index === index) closeEditTaskModal();

  applyDeleteAction(actionItems);

  lastDeletedAction = {
    items: actionItems.map(function(item) {
      return { dateKey: item.dateKey, index: item.index, task: cloneTask(item.task) };
    })
  };

  saveTasksToServer();
  renderTaskList(document.getElementById('modalDate').dataset.dateKey);
  renderCalendar();
  showUndoToast(lastDeletedAction);
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

// ===== 撤回 =====
function showUndoToast(action) {
  var toast = document.getElementById('undoToast');
  var text = document.getElementById('undoToastText');
  var count = action.items.length;
  text.textContent = count === 1 ? '已快速删除 1 条任务' : '已快速删除 ' + count + ' 条任务';
  toast.classList.add('show');
  if (undoToastTimer) clearTimeout(undoToastTimer);
  undoToastTimer = setTimeout(function() { hideUndoToast(); }, UNDO_TOAST_DURATION);
}

function hideUndoToast(clearAction) {
  if (clearAction === undefined) clearAction = true;
  var toast = document.getElementById('undoToast');
  toast.classList.remove('show');
  if (undoToastTimer) { clearTimeout(undoToastTimer); undoToastTimer = null; }
  if (clearAction) lastDeletedAction = null;
}

function undoLastDelete() {
  if (!lastDeletedAction) return;

  var items = lastDeletedAction.items.slice().sort(function(a, b) {
    if (a.dateKey === b.dateKey) return a.index - b.index;
    return a.dateKey.localeCompare(b.dateKey);
  });

  items.forEach(function(item) {
    if (!tasks[item.dateKey]) tasks[item.dateKey] = [];
    tasks[item.dateKey].splice(item.index, 0, cloneTask(item.task));
  });

  saveTasksToServer();
  renderTaskList(document.getElementById('modalDate').dataset.dateKey);
  renderCalendar();
  hideUndoToast(false);
  lastDeletedAction = null;
}

// ===== 批量删除 =====
function openBatchDeleteModal() {
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
  document.getElementById('batchDeleteModal').style.display = 'block';
}

function closeBatchDeleteModal() { document.getElementById('batchDeleteModal').style.display = 'none'; }

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

function executeBatchDelete() {
  var year = parseInt(document.getElementById('batchDeleteYear').value);
  var month = parseInt(document.getElementById('batchDeleteMonth').value);
  var prefix = month === 0 ? year + '-' : year + '-' + pad(month) + '-';

  var keysToDelete = Object.keys(tasks).filter(function(key) { return key.indexOf(prefix) === 0; });
  if (keysToDelete.length === 0) { closeBatchDeleteModal(); return; }

  keysToDelete.forEach(function(key) { delete tasks[key]; });

  saveTasksToServer();
  closeBatchDeleteModal();
  renderCalendar();

  var modalDateEl = document.getElementById('modalDate');
  if (modalDateEl.dataset.dateKey && modalDateEl.dataset.dateKey.indexOf(prefix) === 0) {
    renderTaskList(modalDateEl.dataset.dateKey);
  }
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

function saveSettings() {
  var inputs = document.querySelectorAll('#intervalsEditor input');
  var arr = [];
  inputs.forEach(function(inp) {
    var v = parseInt(inp.value) || 1;
    arr.push(Math.max(1, Math.min(365, v)));
  });
  arr.sort(function(a, b) { return a - b; });
  REVIEW_INTERVALS = arr;
  saveConfigToServer(arr);
}

function resetSettings() {
  REVIEW_INTERVALS = DEFAULT_INTERVALS.slice();
  renderIntervalsEditor();
}
