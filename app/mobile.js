// ===== 移动端 JS - 原生 App 体验 =====
(function() {
  var curDateKey = null;
  var curEditRef = null;
  var newImages = [];
  var editImages = { existing:[], newFiles:[], removed:[] };
  var isProcessing = false;
  var activeDate = null;
  var pendingRevertIdx = -1;
  var inited = false;
  var dataReady = false;

  function initMobile() {
    if (inited) return;
    if (typeof currentUser === 'undefined' || currentUser === null) {
      setTimeout(initMobile, 100);
      return;
    }
    inited = true;
    bindEvents();
    // Only render if data is already loaded, otherwise wait for dataready
    if (dataReady) {
      renderMonth();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobile);
  } else {
    initMobile();
  }

  window.addEventListener('dataready', function() {
    dataReady = true;
    if (inited) {
      renderMonth();
    }
  });

  function q(id) { return document.getElementById(id); }

  function bindEvents() {
    q('mPrevMonth').addEventListener('click', function() {
      currentMonth--; if (currentMonth<0) { currentMonth=11; currentYear--; }
      activeDate = null; renderMonth();
    });
    q('mNextMonth').addEventListener('click', function() {
      currentMonth++; if (currentMonth>11) { currentMonth=0; currentYear++; }
      activeDate = null; renderMonth();
    });
    q('mFab').addEventListener('click', function() { openSheet(getTodayKey()); });
    q('mSettingsBtn').addEventListener('click', openSettings);
    q('mBackBtn').addEventListener('click', closeSettings);
    q('mHistoryBtn').addEventListener('click', openHistory);
    q('mHistoryClose').addEventListener('click', function() { q('mHistorySheet').style.display='none'; });
    q('mSheetClose').addEventListener('click', closeSheet);
    q('mPickImage').addEventListener('click', function() { q('mImageFile').click(); });
    q('mImageFile').addEventListener('change', onPickImage);
    q('mSubmitBtn').addEventListener('click', onSubmit);
    q('mDeleteBtn').addEventListener('click', onDelete);
    q('mSaveSettings').addEventListener('click', saveSettings);
    q('mAddInterval').addEventListener('click', addInterval);
    q('mResetIntervals').addEventListener('click', function() {
      REVIEW_INTERVALS = DEFAULT_INTERVALS.slice(); renderIntervals();
    });
    q('mBatchDelete').addEventListener('click', batchDelete);
    q('mLogoutBtn').addEventListener('click', logout);
    q('mRevertCancel').addEventListener('click', function() { q('mRevertDialog').style.display='none'; });
    q('mRevertOk').addEventListener('click', executeRevert);
    // confirm dialog
    q('mConfirmCancel').addEventListener('click', function() { q('mConfirmDialog').style.display='none'; });
    q('mConfirmDialog').addEventListener('click', function(e) { if (e.target===this) q('mConfirmDialog').style.display='none'; });
    // settings tabs
    document.querySelectorAll('.m-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        document.querySelectorAll('.m-tab').forEach(function(t) { t.classList.remove('active'); });
        this.classList.add('active');
        var panel = this.dataset.panel;
        q('mPanel-intervals').style.display = panel === 'intervals' ? '' : 'none';
        q('mPanel-batchDelete').style.display = panel === 'batchDelete' ? '' : 'none';
        q('mPanel-account').style.display = panel === 'account' ? '' : 'none';
        if (panel === 'batchDelete') renderBatchSelects();
      });
    });
    // image viewer
    q('mImgViewerClose').addEventListener('click', closeImageViewer);
    q('mImageViewer').addEventListener('click', function(e) { if (e.target===this) closeImageViewer(); });
    // overlay dismiss
    q('mTaskSheet').addEventListener('click', function(e) { if (e.target===this) closeSheet(); });
    q('mHistorySheet').addEventListener('click', function(e) { if (e.target===this) q('mHistorySheet').style.display='none'; });
    q('mRevertDialog').addEventListener('click', function(e) { if (e.target===this) q('mRevertDialog').style.display='none'; });
  }

  // ===== 日期工具 =====
  function getTodayKey() {
    var d = new Date();
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  }
  function getDayOfWeek(y,m,d) {
    return ['周日','周一','周二','周三','周四','周五','周六'][new Date(y,m,d).getDay()];
  }

  // ===== 渲染月份 =====
  function renderMonth() {
    var ph = q('mPlaceholder'); if (ph) ph.style.display = 'none';
    var mn = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
    q('mCurrentMonth').textContent = currentYear+'年 '+mn[currentMonth];

    var prefix = currentYear+'-'+pad(currentMonth+1)+'-';
    var dim = new Date(currentYear,currentMonth+1,0).getDate();
    var todayKey = getTodayKey();
    var html = '';
    var hasAny = false;

    for (var d=1; d<=dim; d++) {
      var dk = currentYear+'-'+pad(currentMonth+1)+'-'+pad(d);
      var arr = tasks[dk] || [];
      if (arr.length===0) continue;
      hasAny = true;
      var isToday = dk===todayKey;
      var label = (currentMonth+1)+'月'+d+'日'+getDayOfWeek(currentYear,currentMonth,d)+(isToday?' · 今天':'')+' · '+arr.length+'项';
      html += '<div class="m-day-card'+(isToday?' m-day-today':'')+'">'+
        '<div class="m-day-head" data-dk="'+dk+'">'+
          '<span class="m-day-label">'+label+'</span>'+
          '<span class="m-day-badge">'+arr.length+'</span>'+
        '</div>'+
        '<div class="m-day-body" id="mbody-'+dk+'"></div>'+
      '</div>';
    }

    if (!hasAny) {
      q('mDateList').innerHTML = '';
      q('mEmpty').style.display = 'block';
    } else {
      q('mEmpty').style.display = 'none';
      q('mDateList').innerHTML = html;
      // bind head clicks
      q('mDateList').querySelectorAll('.m-day-head').forEach(function(h) {
        h.addEventListener('click', function() {
          var dk = this.dataset.dk;
          var body = q('mbody-'+dk);
          if (!body) return;
          var isOpen = body.classList.contains('open');
          // close all
          q('mDateList').querySelectorAll('.m-day-body.open').forEach(function(b) { b.classList.remove('open'); });
          if (!isOpen) {
            renderDayBody(dk);
            body.classList.add('open');
            activeDate = dk;
          } else {
            activeDate = null;
          }
        });
      });
      // reopen active
      if (activeDate) {
        var b = q('mbody-'+activeDate);
        if (b) { renderDayBody(activeDate); b.classList.add('open'); }
      }
    }
  }

  function renderDayBody(dk) {
    var el = q('mbody-'+dk);
    if (!el) return;
    var arr = tasks[dk] || [];
    if (arr.length===0) {
      el.innerHTML = '<div class="m-day-empty">暂无任务</div>';
      return;
    }
    el.innerHTML = arr.map(function(t,i) {
      var imgs = '';
      if (t.images && t.images.length) {
        imgs = '<div class="m-task-imgs">'+
          t.images.slice(0,5).map(function(img) { return '<img src="'+img+'" alt="">'; }).join('')+
          (t.images.length>5?'<span class="m-task-more-img">+'+ (t.images.length-5)+'</span>':'')+
        '</div>';
      }
      var cls = t.isReview ? ' review' : '';
      return '<div class="m-task'+cls+'">'+
        '<span class="m-task-dot"></span>'+
        '<div class="m-task-info">'+
          '<div class="m-task-text'+(t.text?'':' no-text')+'">'+escapeHtml(t.text||'(无文字)')+'</div>'+
          '<div class="m-task-meta">'+(t.isReview?'复习 · 源自'+t.originalDate:'原始任务')+'</div>'+
          imgs+
        '</div>'+
        '<div class="m-task-btns">'+
          '<button data-dk="'+dk+'" data-idx="'+i+'" class="m-edit-btn">编辑</button>'+
          '<button data-dk="'+dk+'" data-idx="'+i+'" class="m-del">删除</button>'+
        '</div>'+
      '</div>';
    }).join('')+
    '<div class="m-day-add"><button data-dk="'+dk+'" class="m-day-add-btn">+ 添加任务</button></div>';

    // bind task buttons
    el.querySelectorAll('.m-edit-btn').forEach(function(b) {
      b.addEventListener('click', function(e) {
        e.stopPropagation();
        openSheetForEdit(this.dataset.dk, parseInt(this.dataset.idx));
      });
    });
    el.querySelectorAll('.m-del').forEach(function(b) {
      b.addEventListener('click', function(e) {
        e.stopPropagation();
        var dk = this.dataset.dk, idx = parseInt(this.dataset.idx);
        var task = tasks[dk] && tasks[dk][idx];
        if (!task) return;
        if (!confirm('确定删除该任务'+(task.isReview?'（含关联复习）':'')+'？')) return;
        deleteTask(dk, idx);
      });
    });
    el.querySelectorAll('.m-task-info').forEach(function(info) {
      info.addEventListener('click', function() {
        // find parent task buttons
        var btns = this.parentElement.querySelector('.m-task-btns');
        if (btns) {
          var editBtn = btns.querySelector('.m-edit-btn');
          if (editBtn) openSheetForEdit(editBtn.dataset.dk, parseInt(editBtn.dataset.idx));
        }
      });
    });
    el.querySelectorAll('.m-day-add-btn').forEach(function(b) {
      b.addEventListener('click', function(e) {
        e.stopPropagation();
        openSheet(this.dataset.dk);
      });
    });
    // bind image click -> viewer
    el.querySelectorAll('.m-task-imgs img').forEach(function(img) {
      img.addEventListener('click', function(e) {
        e.stopPropagation();
        openImageViewer(this.src);
      });
    });
  }

  function setDateSelects(dk) {
    var parts = dk.split('-');
    var y = parseInt(parts[0]), m = parseInt(parts[1]), d = parseInt(parts[2]);
    var thisYear = new Date().getFullYear();
    var minY = Math.min(thisYear - 2, y), maxY = Math.max(thisYear + 2, y);
    var yHtml = '';
    for (var yi = minY; yi <= maxY; yi++) {
      yHtml += '<option value="'+yi+'"'+(yi===y?' selected':'')+'>'+yi+'年</option>';
    }
    q('mSheetYear').innerHTML = yHtml;
    // month
    var mHtml = '';
    for (var mi = 1; mi <= 12; mi++) {
      mHtml += '<option value="'+mi+'"'+(mi===m?' selected':'')+'>'+mi+'月</option>';
    }
    q('mSheetMonth').innerHTML = mHtml;
    // day - depends on year/month
    renderDaySelect(y, m, d);
    // bind change to re-render days, preserving selected day
    q('mSheetYear').onchange = function() {
      var curDay = parseInt(q('mSheetDay').value) || 1;
      renderDaySelect(parseInt(this.value), parseInt(q('mSheetMonth').value), curDay);
    };
    q('mSheetMonth').onchange = function() {
      var curDay = parseInt(q('mSheetDay').value) || 1;
      renderDaySelect(parseInt(q('mSheetYear').value), parseInt(this.value), curDay);
    };
  }

  function renderDaySelect(y, m, selDay) {
    var dim = new Date(y, m, 0).getDate();
    if (selDay && selDay > dim) selDay = dim;
    var dHtml = '';
    for (var di = 1; di <= dim; di++) {
      dHtml += '<option value="'+di+'"'+(selDay===di?' selected':'')+'>'+di+'日</option>';
    }
    q('mSheetDay').innerHTML = dHtml;
  }

  function getDateFromSelects() {
    var y = q('mSheetYear').value;
    var m = pad(parseInt(q('mSheetMonth').value));
    var d = pad(parseInt(q('mSheetDay').value));
    return y + '-' + m + '-' + d;
  }

  // ===== Sheet (add/edit) =====
  function openSheet(dk) {
    curDateKey = dk;
    curEditRef = null;
    newImages = [];
    q('mSheetTitle').textContent = '添加任务';
    setDateSelects(dk);
    q('mTaskInput').value = '';
    q('mSyncReviews').checked = false;
    q('mSubmitBtn').textContent = '添加任务';
    q('mSubmitBtn').style.display = '';
    q('mDeleteBtn').style.display = 'none';
    renderImgPreview();
    q('mTaskSheet').style.display = 'flex';
    setTimeout(function() { q('mTaskInput').focus(); }, 300);
  }

  function openSheetForEdit(dk, idx) {
    var task = tasks[dk] && tasks[dk][idx];
    if (!task) return;
    curDateKey = dk;
    curEditRef = { dk:dk, idx:idx };
    newImages = [];
    editImages = {
      existing: task.images ? task.images.slice() : [],
      newFiles: [],
      removed: []
    };
    q('mSheetTitle').textContent = '编辑任务';
    setDateSelects(dk);
    q('mTaskInput').value = task.text;
    q('mSyncReviews').checked = false;
    q('mSubmitBtn').textContent = '保存修改';
    q('mSubmitBtn').style.display = '';
    q('mDeleteBtn').style.display = '';
    renderImgPreview();
    q('mTaskSheet').style.display = 'flex';
  }

  function closeSheet() {
    q('mTaskSheet').style.display = 'none';
    curDateKey = null;
    curEditRef = null;
    newImages = [];
    editImages = { existing:[], newFiles:[], removed:[] };
  }

  function openImageViewer(src) {
    q('mImgViewerImg').src = src;
    q('mImageViewer').style.display = 'flex';
  }
  function closeImageViewer() {
    q('mImageViewer').style.display = 'none';
    q('mImgViewerImg').src = '';
  }

  // ===== 图片处理 =====
  function onPickImage(e) {
    if (!e.target.files.length) return;
    if (curEditRef) {
      editImages.newFiles.push.apply(editImages.newFiles, Array.from(e.target.files));
      var limit = 9 - editImages.existing.length;
      if (editImages.newFiles.length > Math.max(limit,0)) editImages.newFiles = editImages.newFiles.slice(0,Math.max(limit,0));
    } else {
      newImages.push.apply(newImages, Array.from(e.target.files));
      if (newImages.length > 9) newImages = newImages.slice(0,9);
    }
    renderImgPreview();
    e.target.value = '';
  }

  function renderImgPreview() {
    var container = q('mImgPreview');
    if (curEditRef) {
      var imgs = editImages.existing.concat(editImages.newFiles);
      container.innerHTML = imgs.map(function(item, i) {
        var url = typeof item==='string' ? item : URL.createObjectURL(item);
        var isExisting = i < editImages.existing.length;
        return '<div class="m-img-item">'+
          '<img src="'+url+'" alt="">'+
          '<button class="m-img-del">&times;</button>'+
        '</div>';
      }).join('');
      // bind remove buttons
      container.querySelectorAll('.m-img-del').forEach(function(btn, i) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          if (i < editImages.existing.length) editImages.existing.splice(i,1);
          else editImages.newFiles.splice(i-editImages.existing.length,1);
          renderImgPreview();
        });
      });
      // bind image click -> viewer
      container.querySelectorAll('.m-img-item img').forEach(function(img) {
        img.addEventListener('click', function(e) {
          e.stopPropagation();
          openImageViewer(this.src);
        });
      });
    } else {
      container.innerHTML = newImages.map(function(file, i) {
        return '<div class="m-img-item">'+
          '<img src="'+URL.createObjectURL(file)+'" alt="">'+
          '<button class="m-img-del">&times;</button>'+
        '</div>';
      }).join('');
      container.querySelectorAll('.m-img-del').forEach(function(btn, i) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          newImages.splice(i,1);
          renderImgPreview();
        });
      });
      // bind image click -> viewer
      container.querySelectorAll('.m-img-item img').forEach(function(img) {
        img.addEventListener('click', function(e) {
          e.stopPropagation();
          openImageViewer(this.src);
        });
      });
    }
  }

  // ===== 提交（添加/编辑） =====
  async function onSubmit() {
    if (isProcessing) return;
    curDateKey = getDateFromSelects();
    if (!curDateKey) return;
    var input = q('mTaskInput');
    var text = input.value.trim();
    if (text.length > 500) text = text.slice(0,500);
    var hasText = !!text;
    var hasImg = curEditRef
      ? (editImages.existing.length + editImages.newFiles.length > 0)
      : newImages.length > 0;
    if (!hasText && !hasImg) return;

    isProcessing = true;
    q('mSubmitBtn').textContent = '处理中...';
    q('mSubmitBtn').style.opacity = '0.6';

    try {
      if (curEditRef) {
        await doEdit(text);
      } else {
        await doAdd(text);
      }
    } finally {
      isProcessing = false;
      q('mSubmitBtn').textContent = curEditRef ? '保存修改' : '添加任务';
      q('mSubmitBtn').style.opacity = '';
    }
  }

  async function doAdd(text) {
    var filenames = newImages.length > 0 ? await filesToBase64(newImages) : [];
    if (!tasks[curDateKey]) tasks[curDateKey] = [];
    var snapshot = JSON.parse(JSON.stringify(tasks));

    tasks[curDateKey].push({
      text: text,
      isReview: false,
      createdAt: new Date().toISOString(),
      images: filenames.length > 0 ? filenames : undefined
    });
    if (q('mSyncReviews').checked) {
      addReviewTasks(curDateKey, text, filenames);
    }

    var ok = await saveTasksToServer();
    if (!ok) { tasks = snapshot; alert('保存失败: ' + (window._lastSaveError || '未知错误')); return; }
    recordHistory('add', '添加任务: '+(text||'(图片)').slice(0,20), snapshot);
    closeSheet();
    renderMonth();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function doEdit(text) {
    var dk = curEditRef.dk, idx = curEditRef.idx;
    var task = tasks[dk] && tasks[dk][idx];
    if (!task) return;

    var oldText = task.text;
    var snapshot = JSON.parse(JSON.stringify(tasks));

    if (text && text !== oldText) {
      tasks[dk][idx].text = text;
      syncReviewTexts(task, dk, oldText, text);
    }

    var newBase64 = editImages.newFiles.length > 0 ? await filesToBase64(editImages.newFiles) : [];
    var finalImgs = editImages.existing.concat(newBase64);
    tasks[dk][idx].images = finalImgs.length > 0 ? finalImgs : undefined;

    var ok = await saveTasksToServer();
    if (!ok) { tasks = snapshot; alert('保存失败: ' + (window._lastSaveError || '未知错误')); return; }
    recordHistory('edit', '编辑任务: '+(text||'(图片)').slice(0,20), snapshot);
    closeSheet();
    renderMonth();
  }

  // ===== 删除 =====
  async function deleteTask(dk, idx) {
    var items = createDeleteAction(dk, idx);
    if (!items || items.length===0) return;
    var snapshot = JSON.parse(JSON.stringify(tasks));
    applyDeleteAction(items);

    var ok = await saveTasksToServer();
    if (!ok) { tasks = snapshot; return; }
    recordHistory('delete', '删除 '+items.length+' 条任务', snapshot);
    closeSheet();
    renderMonth();
  }

  // 编辑界面中的删除按钮
  async function onDelete() {
    if (!curEditRef) return;
    var dk = curEditRef.dk, idx = curEditRef.idx;
    var task = tasks[dk] && tasks[dk][idx];
    if (!task) return;
    if (!confirm('确定删除该任务'+(task.isReview?'（含关联复习）':'')+'？')) return;
    closeSheet();
    await deleteTask(dk, idx);
  }

  // ===== 设置 =====
  function openSettings() {
    q('mAccountName').textContent = currentUser ? currentUser.username : '';
    renderIntervals();
    renderBatchSelects();
    // reset tabs to default
    document.querySelectorAll('.m-tab').forEach(function(t) { t.classList.remove('active'); });
    var defaultTab = document.querySelector('.m-tab[data-panel="intervals"]');
    if (defaultTab) defaultTab.classList.add('active');
    q('mPanel-intervals').style.display = '';
    q('mPanel-batchDelete').style.display = 'none';
    q('mPanel-account').style.display = 'none';
    q('mSettingsPage').style.display = 'flex';
  }
  function closeSettings() { q('mSettingsPage').style.display = 'none'; }

  function renderIntervals() {
    if (!REVIEW_INTERVALS || REVIEW_INTERVALS.length === 0) {
      REVIEW_INTERVALS = DEFAULT_INTERVALS.slice();
    }
    var c = q('mIntervals');
    var canDelete = REVIEW_INTERVALS.length > 5;
    c.innerHTML = REVIEW_INTERVALS.map(function(v,i) {
      return '<div class="m-int-row">'+
        '<span class="m-int-label">第'+(i+1)+'次复习</span>'+
        '<input type="number" min="1" max="365" value="'+v+'">'+
        '<span>天后</span>'+
        '<button class="m-int-x'+(canDelete?'':' hidden')+'">&times;</button>'+
      '</div>';
    }).join('');
    c.querySelectorAll('.m-int-x').forEach(function(b) {
      b.addEventListener('click', function() {
        var rows = c.querySelectorAll('.m-int-row');
        if (rows.length <= 5) return;
        this.closest('.m-int-row').remove();
        toggleIntervalDeleteBtns();
      });
    });
  }

  function addInterval() {
    var c = q('mIntervals');
    var rows = c.querySelectorAll('.m-int-row');
    var last = rows.length>0 ? rows[rows.length-1].querySelector('input') : null;
    var v = last ? Math.min((parseInt(last.value)||1)*2,365) : 1;
    var div = document.createElement('div');
    div.className = 'm-int-row';
    div.innerHTML = '<span class="m-int-label">第'+(rows.length+1)+'次复习</span>'+
      '<input type="number" min="1" max="365" value="'+v+'">'+
      '<span>天后</span>'+
      '<button class="m-int-x">&times;</button>';
    div.querySelector('.m-int-x').addEventListener('click', function() {
      var curRows = c.querySelectorAll('.m-int-row');
      if (curRows.length <= 5) return;
      div.remove();
      toggleIntervalDeleteBtns();
    });
    c.appendChild(div);
    toggleIntervalDeleteBtns();
  }

  function toggleIntervalDeleteBtns() {
    var rows = q('mIntervals').querySelectorAll('.m-int-row');
    var show = rows.length > 5;
    rows.forEach(function(row) {
      var btn = row.querySelector('.m-int-x');
      if (show) btn.classList.remove('hidden');
      else btn.classList.add('hidden');
    });
  }

  async function saveSettings() {
    var inputs = q('mIntervals').querySelectorAll('input');
    var arr = [];
    inputs.forEach(function(inp) { var v=parseInt(inp.value)||1; arr.push(Math.max(1,Math.min(365,v))); });
    arr.sort(function(a,b) { return a-b; });
    if (arr.length < DEFAULT_INTERVALS.length) arr = DEFAULT_INTERVALS.slice();
    var old = REVIEW_INTERVALS;
    REVIEW_INTERVALS = arr;
    var ok = await saveConfigToServer(arr);
    if (!ok) { REVIEW_INTERVALS = old; return; }
    renderIntervals();
  }

  function renderBatchSelects() {
    var years = {};
    Object.keys(tasks).forEach(function(k) { years[parseInt(k.split('-')[0])]=true; });
    var sy = Object.keys(years).map(Number).sort(function(a,b){return b-a;});
    if (sy.length===0) sy=[new Date().getFullYear()];
    var mn=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
    q('mBatchYear').innerHTML = sy.map(function(y){return'<option value="'+y+'">'+y+'年</option>';}).join('');
    q('mBatchMonth').innerHTML = '<option value="0">全部月份</option>'+mn.map(function(n,i){return'<option value="'+(i+1)+'">'+n+'</option>';}).join('');
  }

  async function batchDelete() {
    var y = parseInt(q('mBatchYear').value), m = parseInt(q('mBatchMonth').value);
    var prefix = m===0 ? y+'-' : y+'-'+pad(m)+'-';
    var keys = Object.keys(tasks).filter(function(k){return k.indexOf(prefix)===0;});
    if (keys.length===0) return;
    var total = 0; keys.forEach(function(k){ total+=(tasks[k]||[]).length; });
    var scope = m===0 ? y+'年全年' : y+'年'+m+'月';
    showConfirm('确认删除', '确定删除 ' + scope + ' 共 ' + total + ' 条任务？此操作不可撤回。', async function() {
      var btn = q('mBatchDelete');
      btn.disabled = true;
      btn.textContent = '删除中...';
      btn.style.opacity = '0.6';

      var snapshot = JSON.parse(JSON.stringify(tasks));
      keys.forEach(function(k){ delete tasks[k]; });
      var ok = await saveTasksToServer();
      if (!ok) {
        tasks = snapshot;
        btn.disabled = false;
        btn.textContent = '确认删除';
        btn.style.opacity = '';
        alert('删除失败，请重试');
        return;
      }
      recordHistory('batch-delete', '批量删除 ' + scope + ' ' + total + '条', snapshot);

      btn.disabled = false;
      btn.textContent = '确认删除';
      btn.style.opacity = '';

      renderMonth();
      renderBatchSelects();
      showToast('已成功删除 ' + scope + ' 共 ' + total + ' 条任务');
    }, '确认删除');
  }

  function logout() {
    try { localStorage.removeItem('mcs_cache_'+getUserId()); } catch(e) {}
    try { localStorage.removeItem('mcs_history_'+getUserId()); } catch(e) {}
    localStorage.removeItem('user');
    window.location.href = '/login.html';
  }

  // ===== 历史 =====
  function openHistory() {
    var c = q('mHistoryContent');
    if (operationHistory.length===0) {
      c.innerHTML = '<div class="m-hist-empty">暂无操作记录<br><small style="color:#bbb;">添加或删除任务后会自动记录</small></div>';
    } else {
      c.innerHTML = operationHistory.map(function(e,i) {
        var t = new Date(e.time);
        var ts = (t.getMonth()+1)+'/'+t.getDate()+' '+('0'+t.getHours()).slice(-2)+':'+('0'+t.getMinutes()).slice(-2);
        return '<div class="m-hist-item" data-idx="'+i+'">'+
          '<div class="m-hist-left"><div class="m-hist-desc">'+escapeHtml(e.description)+'</div><div class="m-hist-time">'+ts+'</div></div>'+
          '<span class="m-hist-badge '+e.type+'">'+getTypeLabel(e.type)+'</span>'+
        '</div>';
      }).join('');
      c.querySelectorAll('.m-hist-item').forEach(function(item) {
        item.addEventListener('click', function() {
          pendingRevertIdx = parseInt(this.dataset.idx);
          q('mRevertDetail').textContent = operationHistory[pendingRevertIdx].description;
          q('mRevertDialog').style.display = 'flex';
        });
      });
    }
    q('mHistorySheet').style.display = 'flex';
  }

  async function executeRevert() {
    var idx = pendingRevertIdx;
    q('mRevertDialog').style.display = 'none';
    if (idx<0||idx>=operationHistory.length) return;
    var entry = operationHistory[idx];
    var snap = idx===0 ? entry.snapshot : operationHistory[idx-1].snapshot;
    var pre = JSON.parse(JSON.stringify(tasks));
    tasks = JSON.parse(JSON.stringify(snap));

    var ok = await saveTasksToServer();
    if (!ok) { loadData(); return; }

    recordHistory('edit', '回退: '+entry.description, pre);
    q('mHistorySheet').style.display = 'none';
    renderMonth();
    showRevertToast(entry.description);
  }

})();
