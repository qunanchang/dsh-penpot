// dsh-penpot browser half.
// Loaded through the DSH client ModuleLoader; registers one sidebar tab that embeds
// the Penpot editor served by the host half's same-origin reverse proxy, plus file
// management (create / rename / duplicate / delete) backed by the same host routes.
window.__ModuleLoader__.load({
  id: 'dsh-penpot',
  factory: function (require) {
    var module = { exports: {} };
    var react = require('react');
    var h = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;

    var LS_KEY = 'dsh-penpot:selected-file';
    var BAR = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--dsw-alias-border-1, rgba(128,128,128,0.25))', fontSize: 12, flex: '0 0 auto' };
    var BTN = { fontSize: 12, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-1, rgba(128,128,128,0.35))', background: 'transparent', color: 'inherit', cursor: 'pointer' };
    var ICON_BTN = { fontSize: 12, lineHeight: '18px', width: 24, height: 22, padding: 0, borderRadius: 6, border: '1px solid var(--dsw-alias-border-1, rgba(128,128,128,0.35))', background: 'transparent', color: 'inherit', cursor: 'pointer' };
    var SELECT = { flex: '1 1 auto', minWidth: 0, fontSize: 12, padding: '2px 4px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-1, rgba(128,128,128,0.35))', background: 'var(--dsw-alias-bg-layer-1, transparent)', color: 'inherit' };
    var DOT = { width: 8, height: 8, borderRadius: 8, flex: '0 0 auto', display: 'inline-block' };
    var PLACEHOLDER = { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center', fontSize: 12, opacity: 0.75, lineHeight: 1.7 };
    var MASK = { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 30, padding: 16 };
    var DIALOG = { width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 10, background: 'var(--dsw-alias-bg-layer-1, #1f2126)', border: '1px solid var(--dsw-alias-border-1, rgba(128,128,128,0.35))', boxShadow: '0 10px 30px rgba(0,0,0,0.35)', fontSize: 12 };
    var INPUT = { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-1, rgba(128,128,128,0.35))', background: 'transparent', color: 'inherit' };
    var DIALOG_FOOT = { display: 'flex', justifyContent: 'flex-end', gap: 8 };
    var PRIMARY = { fontSize: 12, padding: '3px 12px', borderRadius: 6, border: '1px solid var(--dsw-alias-brand-primary, #4f7cff)', background: 'var(--dsw-alias-brand-primary, #4f7cff)', color: '#fff', cursor: 'pointer' };
    var DANGER = Object.assign({}, PRIMARY, { border: '1px solid #d9534f', background: '#d9534f' });

    function readSelected() {
      try {
        return window.localStorage.getItem(LS_KEY) || '';
      } catch (err) {
        return '';
      }
    }

    function writeSelected(id) {
      try {
        window.localStorage.setItem(LS_KEY, id || '');
      } catch (err) {
        /* private mode */
      }
    }

    function getJson(url) {
      return fetch(url, { credentials: 'same-origin' }).then(function (res) {
        return res.json();
      });
    }

    function postJson(url, body) {
      return fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || !data || data.ok === false) {
            var message = (data && data.error) || 'HTTP ' + res.status;
            throw new Error(message);
          }
          return data;
        });
      });
    }

    function PenpotTab() {
      var initial = useState(readSelected);
      var selectedId = initial[0];
      var setSelectedId = initial[1];
      var statusState = useState(null);
      var status = statusState[0];
      var setStatus = statusState[1];
      var filesState = useState([]);
      var files = filesState[0];
      var setFiles = filesState[1];
      var errorState = useState('');
      var error = errorState[0];
      var setError = errorState[1];
      var busyState = useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var srcState = useState('');
      var src = srcState[0];
      var setSrc = srcState[1];
      var externalState = useState('http://localhost:9001');
      var external = externalState[0];
      var setExternal = externalState[1];
      var dialogState = useState(null);
      var dialog = dialogState[0];
      var setDialog = dialogState[1];
      var dialogErrorState = useState('');
      var dialogError = dialogErrorState[0];
      var setDialogError = dialogErrorState[1];
      var submittingState = useState(false);
      var submitting = submittingState[0];
      var setSubmitting = submittingState[1];
      var exportInfoState = useState(null);
      var exportInfo = exportInfoState[0];
      var setExportInfo = exportInfoState[1];
      var exportPageState = useState('');
      var exportPage = exportPageState[0];
      var setExportPage = exportPageState[1];
      var exportScaleState = useState('2');
      var exportScale = exportScaleState[0];
      var setExportScale = exportScaleState[1];
      var exportFormatState = useState('png');
      var exportFormat = exportFormatState[0];
      var setExportFormat = exportFormatState[1];
      var exportResultState = useState(null);
      var exportResult = exportResultState[0];
      var setExportResult = exportResultState[1];
      var exportBusyState = useState(false);
      var exportBusy = exportBusyState[0];
      var setExportBusy = exportBusyState[1];
      var mcpStatusState = useState(null);
      var mcpStatus = mcpStatusState[0];
      var setMcpStatus = mcpStatusState[1];
      var mcpCodeState = useState('var p = penpot.currentPage;\nreturn { page: p && p.name, shapes: p ? p.findShapes().length : 0 };');
      var mcpCode = mcpCodeState[0];
      var setMcpCode = mcpCodeState[1];
      var mcpResultState = useState(null);
      var mcpResult = mcpResultState[0];
      var setMcpResult = mcpResultState[1];
      var mcpBusyState = useState(false);
      var mcpBusy = mcpBusyState[0];
      var setMcpBusy = mcpBusyState[1];

      function load(force) {
        setBusy(true);
        setError('');
        Promise.all([getJson('/penpot/status'), getJson('/penpot/files' + (force ? '?refresh=1' : ''))])
          .then(function (out) {
            var health = out[0] || {};
            var listing = out[1] || {};
            var list = Array.isArray(listing.files) ? listing.files : [];
            setStatus(health);
            setFiles(list);
            if (listing.ok === false && listing.error) setError(listing.error);
            if (!readSelected() && list.length) setSelectedId(list[0].id);
            setBusy(false);
          })
          .catch(function (err) {
            setBusy(false);
            setError(String((err && err.message) || err));
          });
      }

      function loadMcp() {
        getJson('/penpot/mcp/status')
          .then(function (data) {
            setMcpStatus(data && data.ok !== false ? data : null);
          })
          .catch(function () {
            setMcpStatus(null);
          });
      }

      useEffect(function () {
        load(false);
        loadMcp();
      }, []);

      useEffect(function () {
        if (dialog && dialog.mode === 'mcp') loadMcp();
      }, [dialog && dialog.mode]);

      useEffect(function () {
        var file = null;
        for (var i = 0; i < files.length; i += 1) {
          if (files[i].id === selectedId) {
            file = files[i];
            break;
          }
        }
        if (!file || !status || !status.proxy || !status.proxy.ready) return;
        writeSelected(file.id);
        var port = status.proxy.port;
        var host = window.location.hostname;
        var base = 'http://' + host + ':' + port + '/';
        var query = 'team-id=' + encodeURIComponent(file.teamId || '') + '&file-id=' + encodeURIComponent(file.id);
        setSrc(base + '#/workspace?' + query);
        getJson('/penpot/open?fileId=' + encodeURIComponent(file.id) + '&teamId=' + encodeURIComponent(file.teamId || ''))
          .then(function (data) {
            if (data && data.ok && data.url) {
              setSrc(data.url);
              if (data.externalUrl) setExternal(data.externalUrl);
              else if (data.origin) setExternal(data.origin);
            }
          })
          .catch(function () {
            /* keep the locally composed URL */
          });
      }, [selectedId, status && status.proxy && status.proxy.port]);

      var penpot = (status && status.penpot) || {};
      var proxy = (status && status.proxy) || {};
      var dotColor = !status ? 'rgba(128,128,128,0.6)' : penpot.reachable ? '#2ecc71' : '#e74c3c';
      var current = null;
      for (var c = 0; c < files.length; c += 1) {
        if (files[c].id === selectedId) {
          current = files[c];
          break;
        }
      }
      var canMutate = Boolean(current) && !busy && !submitting && proxy.ready;

      function openDialog(mode) {
        setDialogError('');
        if (mode === 'create') setDialog({ mode: mode, name: '' });
        else if (mode === 'rename' && current) setDialog({ mode: mode, name: current.name });
        else if (mode === 'duplicate' && current) setDialog({ mode: mode, name: current.name + ' 副本' });
        else if (mode === 'delete' && current) setDialog({ mode: mode, name: current.name });
        else if (mode === 'mcp') {
          setDialog({ mode: mode, name: current ? current.name : '' });
          setMcpResult(null);
          loadMcp();
        }
        else if (mode === 'export' && current) {
          setDialog({ mode: mode, name: current.name });
          setExportInfo(null);
          setExportResult(null);
          setExportPage('');
          setExportBusy(true);
          getJson('/penpot/file-info?fileId=' + encodeURIComponent(current.id))
            .then(function (data) {
              setExportBusy(false);
              if (!data || data.ok === false) {
                setDialogError((data && data.error) || '读取页面失败');
                return;
              }
              setExportInfo(data);
              if (data.pages && data.pages.length) setExportPage(data.pages[0].id);
            })
            .catch(function (err) {
              setExportBusy(false);
              setDialogError(String((err && err.message) || err));
            });
        }
      }

      function closeDialog() {
        setDialog(null);
        setDialogError('');
      }

      function runExport() {
        if (!current || exportBusy) return;
        setExportBusy(true);
        setDialogError('');
        setExportResult(null);
        postJson('/penpot/files/export', {
          fileId: current.id,
          pageId: exportPage || undefined,
          scale: Number(exportScale) || 2,
          format: exportFormat,
        })
          .then(function (data) {
            setExportBusy(false);
            setExportResult(data);
          })
          .catch(function (err) {
            setExportBusy(false);
            setDialogError(String((err && err.message) || err));
          });
      }

      function runMcpCode() {
        if (mcpBusy) return;
        var code = String(mcpCode || '');
        if (!code.trim()) {
          setDialogError('代码不能为空');
          return;
        }
        setMcpBusy(true);
        setDialogError('');
        setMcpResult(null);
        postJson('/penpot/mcp/call', { code: code })
          .then(function (data) {
            setMcpBusy(false);
            setMcpResult(data);
            loadMcp();
          })
          .catch(function (err) {
            setMcpBusy(false);
            setDialogError(String((err && err.message) || err));
          });
      }

      function submitDialog() {
        if (!dialog || submitting) return;
        var body = {};
        if (dialog.mode === 'create' || dialog.mode === 'rename' || dialog.mode === 'duplicate') {
          var name = String(dialog.name || '').trim();
          if (!name) {
            setDialogError('名字不能为空');
            return;
          }
          body.name = name;
        }
        if (dialog.mode !== 'create' && current) body.fileId = current.id;
        var url = '/penpot/files/' + dialog.mode;
        setSubmitting(true);
        setDialogError('');
        postJson(url, body)
          .then(function (data) {
            var created = data && data.file ? data.file : null;
            setSubmitting(false);
            setDialog(null);
            if (dialog.mode === 'delete') {
              writeSelected('');
              setSelectedId('');
              setSrc('');
            }
            load(true);
            if (created && created.id) setSelectedId(created.id);
          })
          .catch(function (err) {
            setSubmitting(false);
            setDialogError(String((err && err.message) || err));
          });
      }

      var options = files.map(function (file) {
        return h('option', { key: file.id, value: file.id }, file.name + (file.projectName ? '  ·  ' + file.projectName : ''));
      });
      if (!options.length) options = [h('option', { key: 'none', value: '' }, busy ? '读取文件列表…' : '暂无可用文件')];

      var body;
      if (error) {
        body = h(
          'div',
          { style: PLACEHOLDER },
          h('div', { style: { color: 'var(--dsw-alias-state-warn-primary, #e67e22)', fontWeight: 600 } }, 'Penpot 读取失败'),
          h('div', null, error),
          h('div', null, '检查 Penpot 容器是否在运行：docker compose up -d（默认 http://localhost:9001），以及 access token 是否仍在 ~/.penpot-access-token。'),
          h('a', { href: external, target: '_blank', rel: 'noreferrer', style: BTN }, '直接打开 Penpot')
        );
      } else if (!status) {
        body = h('div', { style: PLACEHOLDER }, busy ? '正在连接 Penpot…' : '等待状态…');
      } else if (!proxy.ready) {
        body = h(
          'div',
          { style: PLACEHOLDER },
          h('div', { style: { fontWeight: 600 } }, '反代未就绪'),
          h('div', null, '宿主侧代理端口没有起来：' + (proxy.error || '未知原因')),
          h('div', null, '端口 9002-9006 可能都被占用，或 Penpot 不可达。')
        );
      } else if (!penpot.reachable) {
        body = h(
          'div',
          { style: PLACEHOLDER },
          h('div', { style: { fontWeight: 600 } }, 'Penpot 后端没有响应'),
          h('div', null, '目标 ' + (penpot.origin || 'http://localhost:9001') + '：' + (penpot.error || '无响应')),
          h('div', null, 'docker compose up -d 之后点右上角「刷新」。')
        );
      } else if (!src) {
        body = h(
          'div',
          { style: PLACEHOLDER },
          h('div', { style: { fontWeight: 600 } }, '选一个文件开始编辑'),
          h('div', null, files.length ? '在上方下拉框里选择文件，或点 ＋ 新建一个。' : '当前账号下没有可编辑文件，点 ＋ 新建一个。')
        );
      } else {
        body = h('iframe', {
          key: src,
          src: src,
          title: 'Penpot',
          style: { flex: '1 1 auto', width: '100%', minHeight: 0, border: 0, background: '#fff' },
          allow: 'clipboard-read; clipboard-write; fullscreen',
        });
      }

      var dialogNode = null;
      if (dialog) {
        var isDelete = dialog.mode === 'delete';
        var isExport = dialog.mode === 'export';
        var isMcp = dialog.mode === 'mcp';
        var titleText = isMcp
          ? 'Penpot MCP · 在当前文件里跑代码'
          : isExport
          ? '导出画板 PNG'
          : dialog.mode === 'create'
            ? '新建 Penpot 文件'
            : dialog.mode === 'rename'
              ? '重命名文件'
              : dialog.mode === 'duplicate'
                ? '复制文件'
                : '删除文件';
        var field;
        if (isMcp) {
          var mcpLine = mcpStatus && mcpStatus.connected
            ? '已连接  ·  ' + (mcpStatus.file || '未打开文件') + (mcpStatus.page ? '  /  ' + mcpStatus.page : '')
            : mcpStatus && mcpStatus.tokenPresent
            ? '未连接：先在下方编辑器里打开该 Penpot 文件（插件需要页面在线）'
            : '未连接：缺少 MCP token（~/.penpot-mcp-token）';
          field = h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.6 } },
              h('span', { style: Object.assign({}, DOT, { background: mcpStatus && mcpStatus.connected ? '#2ecc71' : '#e74c3c' }) }),
              h('span', null, mcpLine)),
            h('textarea', {
              style: Object.assign({}, INPUT, { minHeight: 96, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' }),
              value: mcpCode,
              spellCheck: false,
              onChange: function (event) { setMcpCode(event.target.value); },
            }),
            h('div', { style: { opacity: 0.7, lineHeight: 1.6 } }, '代码按函数体执行，可用 penpot / penpotUtils / storage，return 的值会返回。'),
            mcpResult && mcpResult.text
              ? h('pre', { style: { margin: 0, maxHeight: 200, overflow: 'auto', padding: 8, borderRadius: 6, background: 'rgba(0,0,0,0.25)', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, mcpResult.text)
              : null,
            mcpResult && mcpResult.log
              ? h('pre', { style: { margin: 0, maxHeight: 100, overflow: 'auto', padding: 8, borderRadius: 6, background: 'rgba(0,0,0,0.18)', fontSize: 11, whiteSpace: 'pre-wrap' } }, mcpResult.log)
              : null,
            mcpBusy ? h('div', { style: { opacity: 0.75 } }, '执行中…') : null
          );
        } else if (isExport) {
          var pageOptions = ((exportInfo && exportInfo.pages) || []).map(function (page) {
            return h('option', { key: page.id, value: page.id }, page.name + '（' + page.frameCount + ' 板）');
          });
          if (!pageOptions.length) pageOptions = [h('option', { key: 'none', value: '' }, exportBusy ? '读取页面…' : '没有可导出的页面')];
          var fileList = null;
          if (exportResult && Array.isArray(exportResult.files) && exportResult.files.length) {
            fileList = h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' } },
              h('div', { style: { opacity: 0.8 } }, '已导出 ' + exportResult.count + ' 张 · ' + (exportResult.exportDir || '')),
              exportResult.files.map(function (file) {
                return h(
                  'a',
                  {
                    key: file.url || file.path,
                    href: file.url,
                    target: '_blank',
                    rel: 'noreferrer',
                    style: { color: 'var(--dsw-alias-brand-primary, #4f7cff)', textDecoration: 'none', lineHeight: 1.6 },
                  },
                  file.filename + '  ·  ' + Math.round((file.bytes || 0) / 1024) + ' KB'
                );
              })
            );
          }
          field = h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { style: { lineHeight: 1.7 } }, '文件：' + (dialog.name || '')),
            exportInfo ? h('div', { style: { opacity: 0.75 } }, '共 ' + exportInfo.pages.length + ' 页') : null,
            h('label', { style: { display: 'flex', flexDirection: 'column', gap: 3 } }, '页面', h('select', {
              style: SELECT,
              value: exportPage,
              onChange: function (event) {
                setExportPage(event.target.value);
                setExportResult(null);
              },
            }, pageOptions)),
            h(
              'div',
              { style: { display: 'flex', gap: 8 } },
              h('label', { style: { display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 0' } }, '倍率',
                h('select', { style: SELECT, value: exportScale, onChange: function (event) { setExportScale(event.target.value); setExportResult(null); } },
                  ['1', '2', '3', '4'].map(function (value) { return h('option', { key: value, value: value }, value + 'x'); }))),
              h('label', { style: { display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 0' } }, '格式',
                h('select', { style: SELECT, value: exportFormat, onChange: function (event) { setExportFormat(event.target.value); setExportResult(null); } },
                  ['png', 'jpeg', 'svg'].map(function (value) { return h('option', { key: value, value: value }, value.toUpperCase()); })))
            ),
            fileList,
            exportBusy ? h('div', { style: { opacity: 0.75 } }, exportResult ? '导出中…' : '导出中，较大的画板可能要几十秒…') : null
          );
        } else if (isDelete) {
          field = h('div', { style: { lineHeight: 1.7 } }, '把「' + dialog.name + '」移到回收站？文件仍在 Penpot 的已删除里，可在 Penpot 里恢复。');
        } else {
          field = h('input', {
            style: INPUT,
            value: dialog.name,
            autoFocus: true,
            placeholder: '文件名字',
            onChange: function (event) {
              setDialog({ mode: dialog.mode, name: event.target.value });
            },
            onKeyDown: function (event) {
              if (event.key === 'Enter') submitDialog();
              if (event.key === 'Escape') closeDialog();
            },
          });
        }
        var footButtons = isMcp
          ? [
              h('button', { type: 'button', style: BTN, onClick: closeDialog, disabled: mcpBusy }, '关闭'),
              h('button', { type: 'button', style: BTN, onClick: loadMcp, disabled: mcpBusy }, '刷新状态'),
              h('button', { type: 'button', style: PRIMARY, onClick: runMcpCode, disabled: mcpBusy }, mcpBusy ? '执行中…' : '运行'),
            ]
          : isExport
          ? [
              h('button', { type: 'button', style: BTN, onClick: closeDialog, disabled: exportBusy }, '关闭'),
              h('button', { type: 'button', style: BTN, onClick: runExport, disabled: exportBusy || !exportInfo }, exportResult ? '再次导出' : '开始导出'),
            ]
          : [
              h('button', { type: 'button', style: BTN, onClick: closeDialog, disabled: submitting }, '取消'),
              h('button', { type: 'button', style: isDelete ? DANGER : PRIMARY, onClick: submitDialog, disabled: submitting }, submitting ? '处理中…' : isDelete ? '删除' : '确定'),
            ];
        dialogNode = h(
          'div',
          { style: MASK, role: 'dialog', 'aria-modal': 'true' },
          h(
            'div',
            { style: DIALOG },
            h('div', { style: { fontWeight: 600, fontSize: 13 } }, titleText),
            field,
            dialogError ? h('div', { style: { color: '#e74c3c' } }, dialogError) : null,
            h('div', { style: DIALOG_FOOT }, footButtons)
          )
        );
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', position: 'relative' } },
        h(
          'div',
          { style: BAR },
          h('span', { style: Object.assign({}, DOT, { background: dotColor }), title: penpot.reachable ? 'Penpot 在线' : 'Penpot 离线' }),
          h('span', { style: { fontWeight: 600, flex: '0 0 auto' } }, 'Penpot'),
          h(
            'select',
            {
              style: SELECT,
              value: selectedId,
              onChange: function (event) {
                setSelectedId(event.target.value);
              },
            },
            options
          ),
          h('button', { type: 'button', style: ICON_BTN, title: '新建文件', 'aria-label': '新建文件', onClick: function () { openDialog('create'); }, disabled: busy || submitting }, '＋'),
          h('button', { type: 'button', style: ICON_BTN, title: '重命名当前文件', 'aria-label': '重命名当前文件', onClick: function () { openDialog('rename'); }, disabled: !canMutate }, '✎'),
          h('button', { type: 'button', style: ICON_BTN, title: '复制当前文件', 'aria-label': '复制当前文件', onClick: function () { openDialog('duplicate'); }, disabled: !canMutate }, '⧉'),
          h('button', { type: 'button', style: ICON_BTN, title: '删除当前文件', 'aria-label': '删除当前文件', onClick: function () { openDialog('delete'); }, disabled: !canMutate }, '🗑'),
          h('button', { type: 'button', style: Object.assign({}, BTN, { display: 'inline-flex', alignItems: 'center', gap: 4 }), title: mcpStatus && mcpStatus.connected ? 'MCP 已连接：在当前文件里跑代码' : 'MCP 未连接（点开看原因）', onClick: function () { openDialog('mcp'); } },
            h('span', { style: Object.assign({}, DOT, { background: mcpStatus && mcpStatus.connected ? '#2ecc71' : 'rgba(128,128,128,0.6)' }) }),
            'MCP'),
          h('button', { type: 'button', style: BTN, title: '导出当前文件的画板 PNG', onClick: function () { openDialog('export'); }, disabled: !canMutate }, '导出'),
          h('button', { type: 'button', style: BTN, onClick: function () { load(true); }, disabled: busy }, busy ? '…' : '刷新'),
          h('a', { style: Object.assign({}, BTN, { textDecoration: 'none' }), href: external, target: '_blank', rel: 'noreferrer' }, '外部打开')
        ),
        h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', overflow: 'hidden' } }, body),
        dialogNode
      );
    }

    function PenpotIcon(size) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 4, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M8 16.5V7.5h4.2a3 3 0 0 1 0 6H10', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' })
      );
    }

    function apply(ctx) {
      if (!ctx || !ctx.betterSidebar || typeof ctx.betterSidebar.registerTab !== 'function') return;
      ctx.effect(function () {
        return ctx.betterSidebar.registerTab({
          id: 'dsh-penpot:design',
          title: function () {
            return 'Penpot';
          },
          description: function () {
            return '内置 Penpot 设计工作区：文件下拉、新建/改名/复制/删除、嵌入式编辑器';
          },
          icon: function (size) {
            return PenpotIcon(size);
          },
          order: 60,
          dedupeKey: function () {
            return 'dsh-penpot:design';
          },
          component: PenpotTab,
        });
      });
    }

    module.exports.apply = apply;
    module.exports.inject = ['betterSidebar'];
    module.exports.PenpotTab = PenpotTab;
    return module.exports;
  },
});
