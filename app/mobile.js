// ===== 记忆曲线任务日历 - 移动端 JS =====

(function() {
  var mDateKey = null;
  var mEditRef = null;
  var mNewImages = [];
  var mEditImages = { existing: [], newFiles: [], removed: [] };
  var mAddLock = false;
  var mPendingRevert = -1;
  var mActiveDate = null;

  // Wait for app.js to finish loading (it handles auth + loadData)
  window.addEventListener('load', function() {
    if (!currentUser) return;
    setupMobileEvents();
    renderMobileCalendar();
  });

  function setupMobileEvents() {
    document.getElementById('mPrevMonth').addEventListener('click', function() {
      currentMonth--;
      if (currentMonth < 0) { currentMonth = 11; currentYear--; }
      renderMobileCalendar();
    });
    document.getElementById('mNextMonth').addEventListener('click', function() {
      currentMonth++;
      if (currentMonth > 11) { currentMonth = 0; currentYear++; }
      renderMobileCalendar();
    });
    document.getElementById('mFab').addEventListener('click', function() {
      openAddModal(getTodayKey());
    });
    document.getElementById('mSettingsBtn').addEventListener('click', openMobileSettings);
    document.getElementById('mSettingsBack').addEventListener('click', closeMobileSettings);
    document.getElementById('mHistoryBtn').addEventListener('click', function() {
      renderMobileHistory();
      document.getElementById('mHistorySheet').style.display = 'flex';
    });
    document.getElementById('mAddBtn').addEventListener('click', mobileAddTask);
    document.getElementById('mAddImageBtn').addEventListener('click', function() {
      document.getElementById('mImageInput').click();
    });
    document.getElementById('mImageInput').addEventListener('change', function(e) {
      if (e.target.files.length > 0) {
        mNewImages.push.apply(mNewImages, Array.from(e.target.files));
        if (mNewImages.length > 9) mNewImages = mNewImages.slice(0, 9);
        renderMobileImagePreviews();
        e.target.value = '';
      }
    });
    document.getElementById('mSaveEditBtn').addEventListener('click', mobileSaveEdit);
    document.getElementById('mDeleteTaskBtn').addEventListener('click', mobileDeleteTask);
    document.getElementById('mEditAddImageBtn').addEventListener('click', function() {
      document.getElementById('mEditImageInput').click();
    });
    document.getElementById('mEditImageInput').addEventListener('change', function(e) {
      if (e.target.files.length > 0) {
        mEditImages.newFiles.push.apply(mEditImages.newFiles, Array.from(e.target.files));
        var limit = 9 - mEditImages.existing.length;
        if (mEditImages.newFiles.length > Math.max(limit, 0)) mEditImages.newFiles = mEditImages.newFiles.slice(0, Math.max(limit, 0));
        renderMobileEditImages();
        e.target.value = '';
      }
    });
    document.getElementById('mSaveSettings').addEventListener('click', mobileSaveSettings);
    document.getElementById('mAddInterval').addEventListener('click', mobileAddInterval);
    document.getElementById('mResetIntervals').addEventListener('click', function() {
      REVIEW_INTERVALS = DEFAULT_INTERVALS.slice();
      renderMobileIntervals();
    });
    document.getElementById('mBatchDelete').addEventListener('click', mobileBatchDelete);
    document.getElementById('mLogoutBtn').addEventListener('click', function() {
      try { localStorage.removeItem('mcs_cache_' + getUserId()); } catch (e) {}
      try { localStorage.removeItem('mcs_history_' + getUserId()); } catch (e) {}
      localStorage.removeItem('user');
      window.location.href = '/login.html';
    });
    document.getElementById('mTaskSheet').addEventListener('click', function(e) {
      if (e.target === this) closeTaskSheet();
    });
    document.getElementById('mAddModal').addEventListener('click', function(e) {
      if (e.target === this) closeAddModal();
    });
    document.getElementById('mEditModal').addEventListener('click', function(e) {
      if (e.target === this) closeEditModal();
    });
    document.getElementById('mHistorySheet').addEventListener('click', function(e) {
      if (e.target === this) closeHistorySheet();
    });
    document.getElementById('mRevertDialog').addEventListener('click', function(e) {
      if (e.target === this) cancelMobileRevert();
    });

    window.addEventListener('dataready', function() {
      renderMobileCalendar();
    });
  }

  // ===== Calendar Render =====
  function renderMobileCalendar() {
    var monthNames = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
    document.getElementById('mCurrentMonth').textContent = currentYear + '年 ' + monthNames[currentMonth];

    var prefix = currentYear + '-' + pad(currentMonth + 1) + '-';
    var list = document.getElementById('mDateList');
    var html = '';

    var daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    var today = new Date();
    var todayKey = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());

    var hasAny = false;
    for (var d = 1; d <= daysInMonth; d++) {
      var dateKey = currentYear + '-' + pad(currentMonth + 1) + '-' + pad(d);
      var dayTasks = tasks[dateKey] || [];
      if (dayTasks.length === 0) continue;
      hasAny = true;

      var isToday = dateKey === todayKey;
      var label = (currentMonth + 1) + '月' + d + '日' + (isToday ? ' (今天)' : '') + ' · ' + getDayOfWeek(currentYear, currentMonth, d);
      html += '<div class="m-date-group">' +
        '<div class="m-date-header" onclick="toggleDateGroup(this,\'' + dateKey + '\')">' +
          '<span class="m-date-label">' + label + '</span>' +
          '<span class="m-date-badge">' + dayTasks.length + '</span>' +
        '</div>' +
        '<div class="m-date-tasks" id="mtasks-' + dateKey + '"></div>' +
      '</div>';
    }

    if (!hasAny) {
      html = '<div style="text-align:center;padding:60px 20px;color:#999;">' +
        '<div style="font-size:2.5em;margin-bottom:12px;">&#128203;</div>' +
        '<div>本月暂无任务</div>' +
        '<div style="font-size:0.85em;margin-top:4px;">点击右下角 + 添加任务</div>' +
      '</div>';
    }
    list.innerHTML = html;

    // If previously opened date, re-render its tasks
    if (mActiveDate) {
      renderDateTasks(mActiveDate);
      var el = document.getElementById('mtasks-' + mActiveDate);
      if (el) el.classList.add('open');
    }
  }

  function getDayOfWeek(y, m, d) {
    var days = ['周日','周一','周二','周三','周四','周五','周六'];
    return days[new Date(y, m, d).getDay()];
  }

  window.toggleDateGroup = function(header, dateKey) {
    var tasksEl = document.getElementById('mtasks-' + dateKey);
    if (!tasksEl) return;
    var isOpen = tasksEl.classList.contains('open');
    // Close all others
    document.querySelectorAll('.m-date-tasks.open').forEach(function(el) { el.classList.remove('open'); });
    if (!isOpen) {
      mActiveDate = dateKey;
      renderDateTasks(dateKey);
      tasksEl.classList.add('open');
    } else {
      mActiveDate = null;
    }
  };

  function renderDateTasks(dateKey) {
    var el = document.getElementById('mtasks-' + dateKey);
    if (!el) return;
    var dayTasks = tasks[dateKey] || [];
    if (dayTasks.length === 0) {
      el.innerHTML = '<div class="m-date-empty">暂无任务</div>';
      return;
    }
    el.innerHTML = dayTasks.map(function(task, index) {
      var thumbs = '';
      if (task.images && task.images.length > 0) {
        thumbs = '<div class="m-task-thumbs">' +
          task.images.slice(0, 4).map(function(img) {
            return '<img src="' + img + '" alt="">';
          }).join('') +
          (task.images.length > 4 ? '<span style="font-size:0.7em;color:#999;">+' + (task.images.length - 4) + '</span>' : '') +
          '</div>';
      }
      var isReview = task.isReview;
      return '<div class="m-task-item' + (isReview ? ' review' : '') + '">' +
        '<span class="m-task-dot ' + (isReview ? 'review-dot' : 'original') + '"></span>' +
        '<div class="m-task-info" onclick="mobileEditTask(\'' + dateKey + '\',' + index + ')">' +
          '<div class="m-task-text' + (task.text ? '' : ' empty') + '">' + escapeHtml(task.text || '(无文字)') + '</div>' +
          '<div class="m-task-meta">' + (isReview ? '复习 · 源自' + task.originalDate : '原始任务') + '</div>' +
          thumbs +
        '</div>' +
        '<div class="m-task-actions">' +
          '<button class="m-task-btn" onclick="event.stopPropagation();mobileEditTask(\'' + dateKey + '\',' + index + ')">编辑</button>' +
          '<button class="m-task-btn danger" onclick="event.stopPropagation();mobileConfirmDelete(\'' + dateKey + '\',' + index + ')">&times;</button>' +
        '</div>' +
      '</div>';
    }).join('') +
    '<button class="m-btn-outline m-btn-full" style="margin:8px 0;" onclick="openAddModal(\'' + dateKey + '\')">+ 在此日期添加任务</button>';
  }

  // ===== Add Task =====
  function getTodayKey() {
    var now = new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  window.openAddModal = function(dateKey) {
    mDateKey = dateKey || getTodayKey();
    document.getElementById('mAddDate').textContent = '日期: ' + formatDateKey(mDateKey);
    document.getElementById('mTaskInput').value = '';
    document.getElementById('mSyncReviews').checked = false;
    mNewImages = [];
    renderMobileImagePreviews();
    document.getElementById('mAddModal').style.display = 'flex';
    document.getElementById('mTaskInput').focus();
  };

  function closeAddModal() {
    document.getElementById('mAddModal').style.display = 'none';
    mDateKey = null;
    mNewImages = [];
    renderMobileImagePreviews();
  }
  window.closeAddModal = closeAddModal;

  function renderMobileImagePreviews() {
    var container = document.getElementById('mImagePreviews');
    if (mNewImages.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = mNewImages.map(function(file, i) {
      return '<div class="m-img-item">' +
        '<img src="' + URL.createObjectURL(file) + '" alt="">' +
        '<button class="m-img-remove" onclick="event.stopPropagation();removeMobileNewImage(' + i + ')">&times;</button>' +
        '</div>';
    }).join('');
  }

  window.removeMobileNewImage = function(i) {
    mNewImages.splice(i, 1);
    renderMobileImagePreviews();
  };

  async function mobileAddTask() {
    if (mAddLock) return;
    var input = document.getElementById('mTaskInput');
    var taskText = input.value.trim();
    if (taskText.length > 500) taskText = taskText.slice(0, 500);
    if (!taskText && mNewImages.length === 0) return;
    if (!mDateKey) return;

    mAddLock = true;
    var btn = document.getElementById('mAddBtn');
    btn.textContent = '添加中...';
    btn.disabled = true;

    try {
      var filenames = await filesToBase64(mNewImages);
      if (!tasks[mDateKey]) tasks[mDateKey] = [];

      var snapshot = JSON.parse(JSON.stringify(tasks));

      tasks[mDateKey].push({
        text: taskText,
        isReview: false,
        createdAt: new Date().toISOString(),
        images: filenames.length > 0 ? filenames : undefined
      });

      if (document.getElementById('mSyncReviews').checked) {
        addReviewTasks(mDateKey, taskText, filenames);
      }

      var ok = await saveTasksToServer();
      if (!ok) { tasks = snapshot; return; }

      recordHistory('add', '添加任务: ' + (taskText || '(图片)').slice(0, 20), snapshot);
      closeAddModal();
      renderMobileCalendar();
    } finally {
      btn.textContent = '添加任务';
      btn.disabled = false;
      mAddLock = false;
    }
  }

  // ===== Edit Task =====
  window.mobileEditTask = function(dateKey, index) {
    var task = tasks[dateKey] && tasks[dateKey][index];
    if (!task) return;
    mEditRef = { dateKey: dateKey, index: index };
    mEditImages = {
      existing: task.images ? task.images.slice() : [],
      newFiles: [],
      removed: []
    };
    document.getElementById('mEditInput').value = task.text;
    renderMobileEditImages();
    document.getElementById('mEditModal').style.display = 'flex';
  };

  function closeEditModal() {
    document.getElementById('mEditModal').style.display = 'none';
    mEditRef = null;
    mEditImages = { existing: [], newFiles: [], removed: [] };
  }
  window.closeEditModal = closeEditModal;

  function renderMobileEditImages() {
    var container = document.getElementById('mEditImagePreviews');
    var existing = mEditImages.existing;
    var newFiles = mEditImages.newFiles;
    var html = '';
    existing.forEach(function(img, i) {
      html += '<div class="m-img-item">' +
        '<img src="' + img + '" alt="">' +
        '<button class="m-img-remove" onclick="event.stopPropagation();removeMobileEditExisting(' + i + ')">&times;</button>' +
        '</div>';
    });
    newFiles.forEach(function(file, i) {
      html += '<div class="m-img-item">' +
        '<img src="' + URL.createObjectURL(file) + '" alt="">' +
        '<button class="m-img-remove" onclick="event.stopPropagation();removeMobileEditNew(' + i + ')">&times;</button>' +
        '</div>';
    });
    container.innerHTML = html;
  }

  window.removeMobileEditExisting = function(i) {
    mEditImages.existing.splice(i, 1);
    renderMobileEditImages();
  };

  window.removeMobileEditNew = function(i) {
    mEditImages.newFiles.splice(i, 1);
    renderMobileEditImages();
  };

  async function mobileSaveEdit() {
    if (!mEditRef) return;
    var dateKey = mEditRef.dateKey;
    var index = mEditRef.index;
    var task = tasks[dateKey] && tasks[dateKey][index];
    if (!task) return;

    var oldText = task.text;
    var trimmed = document.getElementById('mEditInput').value.trim();
    if (trimmed.length > 500) trimmed = trimmed.slice(0, 500);

    var snapshot = JSON.parse(JSON.stringify(tasks));

    if (trimmed && trimmed !== oldText) {
      tasks[dateKey][index].text = trimmed;
      syncReviewTexts(task, dateKey, oldText, trimmed);
    }

    var newFilenames = mEditImages.newFiles.length > 0 ? await filesToBase64(mEditImages.newFiles) : [];
    var finalImages = mEditImages.existing.concat(newFilenames);
    tasks[dateKey][index].images = finalImages.length > 0 ? finalImages : undefined;

    var ok = await saveTasksToServer();
    if (!ok) { tasks = snapshot; return; }

    recordHistory('edit', '编辑任务: ' + (trimmed || '(图片)').slice(0, 20), snapshot);
    closeEditModal();
    renderMobileCalendar();
  }

  // ===== Delete Task =====
  window.mobileConfirmDelete = function(dateKey, index) {
    var task = tasks[dateKey] && tasks[dateKey][index];
    if (!task) return;
    if (!confirm('确定删除该任务' + (task.isReview ? '（含关联复习任务）' : '') + '？')) return;
    mobileDeleteTask(dateKey, index);
  };

  async function mobileDeleteTask(dateKey, index) {
    var task = tasks[dateKey] && tasks[dateKey][index];
    if (!task) return;

    var actionItems = createDeleteAction(dateKey, index);
    if (!actionItems || actionItems.length === 0) return;

    var snapshot = JSON.parse(JSON.stringify(tasks));
    applyDeleteAction(actionItems);

    var ok = await saveTasksToServer();
    if (!ok) { tasks = snapshot; return; }

    recordHistory('delete', '删除 ' + actionItems.length + ' 条任务', snapshot);
    closeEditModal();
    renderMobileCalendar();
  }

  // ===== Task Sheet (old modal list) - not used in mobile, keeping closeTaskSheet =====
  window.closeTaskSheet = function() {
    document.getElementById('mTaskSheet').style.display = 'none';
  };

  // ===== Settings =====
  function openMobileSettings() {
    document.getElementById('mAccountName').textContent = currentUser ? currentUser.username : '';
    renderMobileIntervals();
    renderMobileBatchSelects();
    document.getElementById('mSettingsPage').style.display = 'block';
  }

  function closeMobileSettings() {
    document.getElementById('mSettingsPage').style.display = 'none';
  }

  function renderMobileIntervals() {
    var container = document.getElementById('mIntervalsEditor');
    var arr = REVIEW_INTERVALS.slice();
    container.innerHTML = arr.map(function(v, i) {
      return '<div class="m-interval-row">' +
        '<span class="m-i-label">第' + (i + 1) + '次复习</span>' +
        '<input type="number" min="1" max="365" value="' + v + '">' +
        '<span>天后</span>' +
        '<button class="m-i-del" onclick="this.closest(\'.m-interval-row\').remove()">&times;</button>' +
        '</div>';
    }).join('');
  }

  function mobileAddInterval() {
    var container = document.getElementById('mIntervalsEditor');
    var rows = container.querySelectorAll('.m-interval-row');
    var lastInput = rows.length > 0 ? rows[rows.length - 1].querySelector('input') : null;
    var nextVal = lastInput ? Math.min((parseInt(lastInput.value) || 1) * 2, 365) : 1;
    var idx = rows.length + 1;
    var div = document.createElement('div');
    div.className = 'm-interval-row';
    div.innerHTML = '<span class="m-i-label">第' + idx + '次复习</span>' +
      '<input type="number" min="1" max="365" value="' + nextVal + '">' +
      '<span>天后</span>' +
      '<button class="m-i-del" onclick="this.closest(\'.m-interval-row\').remove()">&times;</button>';
    container.appendChild(div);
  }

  async function mobileSaveSettings() {
    var inputs = document.querySelectorAll('#mIntervalsEditor input');
    var arr = [];
    inputs.forEach(function(inp) {
      var v = parseInt(inp.value) || 1;
      arr.push(Math.max(1, Math.min(365, v)));
    });
    arr.sort(function(a, b) { return a - b; });
    var oldIntervals = REVIEW_INTERVALS;
    REVIEW_INTERVALS = arr;
    var ok = await saveConfigToServer(arr);
    if (!ok) { REVIEW_INTERVALS = oldIntervals; return; }
    renderMobileIntervals();
  }

  function renderMobileBatchSelects() {
    var years = {};
    Object.keys(tasks).forEach(function(key) { years[parseInt(key.split('-')[0])] = true; });
    var sortedYears = Object.keys(years).map(Number).sort(function(a, b) { return b - a; });
    if (sortedYears.length === 0) sortedYears = [new Date().getFullYear()];

    var monthNames = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
    document.getElementById('mBatchYear').innerHTML = sortedYears.map(function(y) {
      return '<option value="' + y + '">' + y + '年</option>';
    }).join('');
    document.getElementById('mBatchMonth').innerHTML = '<option value="0">全部月份</option>' +
      monthNames.map(function(name, i) { return '<option value="' + (i + 1) + '">' + name + '</option>'; }).join('');
  }

  async function mobileBatchDelete() {
    var year = parseInt(document.getElementById('mBatchYear').value);
    var month = parseInt(document.getElementById('mBatchMonth').value);
    var prefix = month === 0 ? year + '-' : year + '-' + pad(month) + '-';

    var keys = Object.keys(tasks).filter(function(k) { return k.indexOf(prefix) === 0; });
    if (keys.length === 0) return;

    var total = 0;
    keys.forEach(function(k) { total += (tasks[k] || []).length; });
    if (!confirm('确定删除 ' + (month === 0 ? year + '年全年' : year + '年' + month + '月') + ' 共 ' + total + ' 条任务？')) return;

    var snapshot = JSON.parse(JSON.stringify(tasks));
    keys.forEach(function(k) { delete tasks[k]; });

    var ok = await saveTasksToServer();
    if (!ok) { tasks = snapshot; return; }

    var scope = month === 0 ? year + '年全年' : year + '年' + month + '月';
    recordHistory('batch-delete', '批量删除 ' + scope + ' ' + total + '条', snapshot);
    renderMobileCalendar();
    renderMobileBatchSelects();
  }

  // ===== History =====
  function renderMobileHistory() {
    var container = document.getElementById('mHistoryContent');
    if (operationHistory.length === 0) {
      container.innerHTML = '<div class="m-history-empty">暂无操作记录<br><small style="color:#bbb;">添加或删除任务后会自动记录</small></div>';
      return;
    }
    container.innerHTML = operationHistory.map(function(entry, index) {
      var time = new Date(entry.time);
      var timeStr = (time.getMonth() + 1) + '/' + time.getDate() + ' ' +
        ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2);
      return '<div class="m-history-item" onclick="mobileConfirmRevert(' + index + ')">' +
        '<div class="m-history-left">' +
          '<div class="m-history-desc">' + escapeHtml(entry.description) + '</div>' +
          '<div class="m-history-time">' + timeStr + '</div>' +
        '</div>' +
        '<span class="m-history-badge ' + entry.type + '">' + getTypeLabel(entry.type) + '</span>' +
      '</div>';
    }).join('');
  }

  window.closeHistorySheet = function() {
    document.getElementById('mHistorySheet').style.display = 'none';
  };

  window.mobileConfirmRevert = function(index) {
    if (index < 0 || index >= operationHistory.length) return;
    mPendingRevert = index;
    document.getElementById('mRevertDetail').textContent = operationHistory[index].description;
    document.getElementById('mRevertDialog').style.display = 'flex';
  };

  window.cancelMobileRevert = function() {
    mPendingRevert = -1;
    document.getElementById('mRevertDialog').style.display = 'none';
  };

  window.executeMobileRevert = async function() {
    var index = mPendingRevert;
    mPendingRevert = -1;
    document.getElementById('mRevertDialog').style.display = 'none';
    if (index < 0 || index >= operationHistory.length) return;

    var entry = operationHistory[index];
    var snapshotToRestore = index === 0 ? entry.snapshot : operationHistory[index - 1].snapshot;
    var preRevertSnapshot = JSON.parse(JSON.stringify(tasks));
    tasks = JSON.parse(JSON.stringify(snapshotToRestore));

    var ok = await saveTasksToServer();
    if (!ok) { loadData(); return; }

    recordHistory('edit', '回退: ' + entry.description, preRevertSnapshot);
    closeHistorySheet();
    renderMobileCalendar();
    showRevertToast(entry.description);
  };

})();
