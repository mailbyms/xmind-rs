# 本机 Xmind 逆向分析笔记（重写依据）

分析对象：`C:\Users\DM\AppData\Local\Programs\Xmind\Xmind.exe`
版本：`23.07.180256` / build `202307180703` / Electron（`package.json` 内 `releaseType: vana_win32`）
资源：`resources/app.asar` 173 MB，`app.asar.unpacked`（原生模块 + 静态文件）

复现工具：`scripts/inspect-asar.mjs`（自写 Chromium Pickle / asar 头解析）、`scripts/mine-js.py`（压缩 JS 上下文挖掘）。

---

## 1. 内存占用的实测与成因

`Get-Process Xmind` 实测 7 个进程：

| PID | WorkingSet | Private |
| --- | --- | --- |
| 1900 | 42.8 MB | 13.1 MB |
| 3136 | 105 MB | 212.9 MB |
| 6016 | 255 MB | 217.1 MB |
| 17400 | 153.5 MB | 120.8 MB |
| 20524 | 34.7 MB | 11.1 MB |
| 21324 | 121.3 MB | 66.8 MB |
| 22716 | 175.3 MB | 142.2 MB |
| **合计** | **887.7 MB** | **≈784 MB** |

静态分析印证：

- `app.asar` 共 7028 个文件：`static/` 122.2 MB、`renderer/` 23.2 MB、
  `node_modules/` 15.7 MB、`main/main.bytecode` 2.66 MB。
- **45 个独立 HTML 窗口**（`editor.html`、`welcome.html`、`preferences.html`、
  38 个 `dialog-*.html`、`presentation*.html` …）。每个 Electron `BrowserWindow`
  都是独立渲染进程，连一个「评分」对话框也要加载约 0.45 MB 公共 JS。
- 编辑器首屏 `editor.html` 同步加载 6 个 chunk：
  `runtime.js + 862.js + 2907.js + 6942.js + 2244.js + editor.js`
  = **3.92 MB 压缩 JS**，另加 `uikit.js` 166 KB、`vana.css` 300 KB、
  单个 `allseto.ttf` 字体 31 MB。
- 主进程 `main/main.js` 用 bytenode 加载 V8 字节码，并常驻一个本地 HTTP 服务
  （`/file-cache/remove`、`/current-sheet-theme`、`/theme-editor/*` …）。
- 文件读写走 **JSZip**：打开时把 `.xmind` 解包到 `tempStorageDir`
  （`protocol: "temp-storage"`），保存时 `generateAsync({type:"nodebuffer",
  compression:"STORE"})` 整包重打。工作簿 + 缩略图 + 资源各一份 JS 堆副本。
- 用户目录 `%APPDATA%\Xmind\Electron v3\` 另有 Chromium 全套
  Cache / Code Cache / GPUCache / IndexedDB / blob_storage。

> 结论：省内存不能只靠「换 WebView」，还要削掉多窗口进程、首屏 bundle、
> JSZip 整包副本和超大字体。这正是 Rust 版的设计目标。

## 2. `.xmind` 容器真实结构（取自自带模板）

```
content.json      ← 唯一真实数据
content.xml       ← 固定的「请用 XMind 8 Update 3 打开」警告占位，不是数据
metadata.json     ← creator / activeSheetId / Thumbnail / Create / ...
manifest.json     ← file-entries: 逐个列出 content.json、metadata.json、
                     Thumbnails/thumbnail.png、resources/<sha256>.<ext>
Thumbnails/thumbnail.png
resources/<64 位 SHA-256 hex>.<ext>
```

`content.xml` 恒为 4309 字节的多语言警告。**重写时必须优先读 content.json，
并把 content.xml 当作占位忽略**，否则会把警告文本当成导图内容。

`content.json` 顶层是 **sheet 数组**（不是对象）：

```jsonc
[{
  "id": "...", "class": "sheet", "title": "Map 1",
  "rootTopic": { ... },
  "theme": {                       // 内嵌完整主题，必须原样保留
    "id": "...",
    "centralTopic": {"id":"...", "properties": {...}},
    "mainTopic": {...}, "subTopic": {...}, "summaryTopic": {...},
    "calloutTopic": {...}, "floatingTopic": {...},
    "boundary": {...}, "summary": {...}, "relationship": {...},
    "map": {...}, "importantTopic": {...}, "minorTopic": {...},
    "expiredTopic": {...}, "global": {...},
    "colorThemeId": "...", "skeletonThemeId": "..."
  },
  "topicPositioning": "fixed",
  "extensions": [{"provider":"org.xmind.ui.skeleton.structure.style",
                  "content":{...}}],
  "legend": {"groups":{}, "markers":{}},
  "coreVersion": "1.732.0-beta.21"
}]
```

### topic 字段（4 份样本统计）

| 字段 | 说明 |
| --- | --- |
| `id`, `title` | 必需；`titleUnedited: true` 表示未编辑过的占位标题 |
| `class` | `"topic"` / `"sheet"` |
| `structureClass` | 分支结构，见下表 |
| `children` | `{ attached: [...], detached: [...], summary: [...], callout: [...] }` |
| `branch: "folded"` | **折叠标记**（不是 `folded: true`） |
| `style` | `{ id, properties: {...} }`，另有 `styleId` 引用 |
| `image` | `{ src: "xap:resources/<64hex>.<ext>", width, height, align }` |
| `markers` | 字符串 id 数组，如 `priority-1`、`tag-red`、`flag-red` |
| `labels` | 字符串数组 |
| `notes` | `{ plain: {content} }` / `{ html, text }` |
| `href` | 超链接；`xap:resources/...` 表示附件 |
| `position` | 自由主题坐标 `{x, y}` |
| `extensions` | `[{provider, content:[{name, content}]}]`，例如 `right-number` |
| `boundaries` / `summaries` / `relationships` | 外框、概要、联系线 |
| `customWidth` | 固定主题宽度 |

### 样式属性键（`properties`）

`svg:fill`、`fo:color`、`fo:font-family`、`fo:font-size`("30pt")、
`fo:font-weight` (500/700)、`fo:font-style`、`fo:text-align`、
`fo:text-decoration`、`fo:text-transform`、`line-color`、`line-width`、
`line-pattern`(solid/dash)、`line-class`、`shape-class`、
`border-line-color`、`border-line-width`、`arrow-begin-class`、
`arrow-end-class`、`fill-pattern`、`fill-style`、
`multi-line-colors`、`color-list`、`line-tapered`（map 级）。

### 结构枚举（从 `2907.js` 提取）

`org.xmind.ui.map.clockwise` / `.anticlockwise` / `.unbalanced` / `.floating`、
`org.xmind.ui.logic.right` / `.left`、`org.xmind.ui.tree.right` / `.left`、
`org.xmind.ui.org-chart.down` / `.up`、`org.xmind.ui.timeline.vertical`、
鱼骨图 `FISHBONELEFTHEADED` / `FISHBONERIGHTHEADED`。

### 形状 / 连线枚举（`static/shapes/*.json`）

主题形状：roundedRect、rect、ellipse、ellipserect(capsule)、diamond、
underline、circle、parallelogram、hexagon、stack …
连线：roundedElbow、elbow、straight、curve、bight、fold、roundedfold。

内置主题：`static/styles/themes/` 48 套（B/F/L/M/MT/O/T/TL 系列），
结构为 `{name, content:{...各 level 的 properties + styleId + type}}`。

### 资源命名

`resources/<sha256(bytes) 完整 64 位 hex>.<ext>`；渲染层 `genResourceMap`
用 `CryptoJS.algo.SHA256`。主题里引用为 `xap:resources/<name>`。
manifest 必须逐个登记资源文件。

### 新建文件的默认结构（`editor.js`）

```js
[{ id, class:"sheet", title:"Map 1",
   rootTopic:{ id, class:"topic", title:"Central Topic",
     structureClass:"org.xmind.ui.map.clockwise", titleUnedited:true,
     children:{ attached:[ Main Topic 1..4 ] } } }]
```

## 3. 功能面（从 `zh-CN/translation.json` 2325 条 + 命令 id 提取）

- 编辑：子主题(Tab)、同级主题(Enter)、删除、折叠、拖拽改层级、
  缩进/反缩进、大纲模式(Outliner)、ZEN 模式、演示模式、聚焦模式
- 元素：笔记、标签、标记/贴纸、图片、附件、超链接、主题链接、
  联系线(relationship)、外框(boundary)、概要(summary)、自由主题、
  数学/化学方程、录音笔记、音视频
- 结构：思维导图、逻辑图、树状图、组织结构图、时间线、鱼骨图、矩阵
- 格式：主题形状、分支线样式/粗细/颜色/锥形、字体、快速样式
  (Important/Minor/Expired)、风格编辑器、骨架+配色主题、深色模式
- 文件：多画布(sheet)、加密、最近打开、导出 PNG/PDF/Markdown/Word/OPML、
  打印、Evernote、Biggerplate、在线图库、云同步
- 命令 id 形如 `editor.zoomIn`、`editor.addChildTopic`、`editor.showNotesEditor`、
  `workbench.toggleRightPanel`、`mutateProperty:notes`、`mutate:selectTopics`

## 4. 对 Rust 重写的硬约束

1. **单窗口 + 系统 WebView2**：不产生 45 个渲染进程；只有一个主窗口，
   对话框/面板用同一 DOM 内的懒加载组件。
2. **启动层极小**：首屏只加载 shell；渲染器、AI 面板、检查器、导出器全部
   dynamic import，不内置 31 MB 字体。
3. **文件 IO 全在 Rust**：`zip` crate 流式读写，不经 JSZip、不落临时副本；
   布局计算也在 Rust，WebView 只画矩形/文本/路径。
4. **保真 round-trip**：模型用「已知字段 + `extra` 原样透传」，
   打开用户既有 `.xmind` 再保存时，`theme` / `extensions` / `boundaries` /
   `relationships` / `summaries` / 未知扩展一律不丢。
5. **写出的文件必须能被本机 XMind 打开**：字段名、`branch:"folded"`、
   `xap:resources/` 资源路径、manifest 条目、`content.xml` 占位都要对齐。
6. 只实现自有数据目录 `%APPDATA%\xmind-rs\`，不触碰 XMind 的安装目录或
   `%APPDATA%\Xmind` 用户目录（仅作只读分析源）。

> 注：本机 `main/hook.js` 是第三方注入的本地授权伪造服务，与本任务无关，
> 重写中不会实现或依赖任何授权绕过逻辑。

## 5. Round-trip 实测补充（2026-11-13）

用 `crates/xmind-file/tests/roundtrip.rs` 对 app.asar 里抽出的 4 份真实模板
逐一做「读 → 写 → 再读」并逐键对比 `content.json`，逼出以下容易踩坑的细节：

1. **`manifest.json` 的真实形状是 `{"file-entries": {...}}`**，不是扁平对象；
   `content.xml` **不登记**在 file-entries 里，但 `Thumbnails/thumbnail.png`
   与每个 `resources/<name>` 都要登记。写成扁平对象会让本机 XMind 不认。
2. `manifest.json` 本身**不是资源**。读取容器时必须只把 `resources/`、
   `xap:resources/`、`attachments/`、`xap:attachments/` 前缀的条目送进
   内容寻址仓库；否则保存时会多出一个假的 `resources/manifest.json`。
   其他未知条目（如 `META-INF/*`）原样透传，不静默丢弃。
3. **`class` 字段是可选的**：`learning-and-thinking-class-schedule.xmind`
   的 sheet 与 rootTopic 都没有 `class`。仅在新建文档时补 `"sheet"` /
   `"topic"`，不能给读进来的文件凭空加。
4. **空的 `children: {}` 是有意义的**：部分模板的叶子主题带空对象，
   保存时删掉会改变 JSON。只在「原本就没有子节点」时原样恢复。
5. **数字类型要保真**：`customWidth: 150`、`position: {"x": -120}`
   在真实文件里是整数，模型用 `f64` 会写成 `150.0` / `-120.0`。
   未编辑的字段直接回填原始 JSON 值。
6. **`image` 对象可能带 `align` / `width` / `height`**，`markers` 可能显式
   是空数组：只重建 `{src: ...}` 会抹掉这些属性。
7. **`direction` 不能擅自注入**：真实模板靠 `topicPositioning` /
   自动平衡决定左右，root 子主题上并没有 `direction`。只有用户在本应用里
   显式改过左右方向时才写出该字段。
8. `content.xml` 只有警告占位而无 `content.json` 的包必须报错，
   不能把警告文本解析成导图。

实现策略：`parse_topic` / `parse_sheet` 在删除已知键之前，把易变形字段的
原始 JSON 快照进 `__raw*` / `__parsed*` 内部键（`__` 前缀不会写回
`content.json`）；`topic_to_json` 只在模型值相对解析值发生变化时重建，
否则原样回填。这样「编辑过的字段按 XMind 规范写、没动过的字段一个字节不碰」。

当前验证结果：`cargo test --workspace` 全绿，4 份真实模板的
`content.json` 达到 JSON 值级完全一致。

## 6. 实现完成后的实测（2026-11-13）

`npm run build:app`（`tauri build --no-bundle`）产出
`target/release/xmind-rs.exe`，实测：

| 项 | 原版 XMind (Electron) | xmind-rs |
| --- | --- | --- |
| 主程序 / 资源包 | `app.asar` 166 MB | exe 5.2 MB + `dist/` 286 KB |
| 进程数 | 7 | 1 app + 6 WebView2（系统提供，非内置 Chromium） |
| WorkingSet 合计 | **887.7 MB** | **约 341.5 MB**（打开同一份 82 节点真实模板后） |
| 首屏 JS | 3.92 MB 同步 chunk | 入口 2.35 KB + React 69 KB gzip，其余按需 |

隔离启动验证（设置 `XMIND_RS_DATA_DIR` 与 `WEBVIEW2_USER_DATA_FOLDER`）：

- `startup.log` 记录 `PRODUCTION / embedded frontend | webview: OS-provided |
  eager work: settings.json only`，单窗口 `main`，页面 `http://tauri.localhost/`。
- 通过调试端口调用 Rust IPC：`app_info` 返回 12 种结构，`doc_layout`
  返回 5 节点 / 4 连线；DOM 渲染 5 个节点，中文工具栏/画布正常。
- 走真实链路 `doc_open` → `doc_save`：82 节点模板打开并另存后，
  `content.json` JSON 值级一致、6 个 SVG 资源逐字节相同、
  `content.xml` 占位逐字节相同、manifest 的 `file-entries` 键集合一致。
- 数据只写入自有目录，未触碰 `%APPDATA%\Xmind` 与安装目录。

## 7. 原版页面 DOM 直读与两版渲染对照（2026-11-13）

目的：把保真验证从「文件格式」推进到「页面实际渲染」，用原版 XMind 自己
渲染出的主题集合与坐标，核对 Rust 布局引擎的输出。

### 启动方式（一个必须避开的坑）

```
env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
  ./Xmind.exe --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1
```

从 WorkBuddy 派生的 shell 会继承 `ELECTRON_RUN_AS_NODE=1`，导致 Xmind.exe
以纯 Node 模式运行：此时 `--version` 输出 `v16.17.1`（Node 版本而非 XMind
版本），Chromium 开关报 `bad option` 并以 code 9 退出。清掉该变量后正常。
启动后 `Xmind.exe <file.xmind>` 走单实例转发，不会拉起第二个主进程。

CDP `/json/version`：`Chrome/108.0.5359.215`、`Electron/22.3.1`、
`Xmind/23.07.180256`。`/json/list` 共 5 个 target：`editor.html`（新文档、
文件文档各一）、两个 `editor-frame.html`、一个 `image-generator.html`。

### 原版页面结构

- 画布容器 `.sheet-viewer.active`，主题文本渲染在 SVG `foreignObject`
  内的 XHTML `div`（带 `xmlns`，如中心主题 `font-size:30px` /
  `color:#fff` / `font-family: NeverMind`），不是 `<text>` 节点。
- 渲染进程开启 Node 集成：`require('electron')` 可拿 `ipcRenderer`，
  `require('fs')` 也可用；webpack 全局为 `webpackChunkxmind_vana`。
- DOM 直接列出骨架枚举（思维导图 / 逻辑图 / 括号图 / 组织结构图 /
  树形图 / 时间轴 / 鱼骨图 / 树型表格 / 矩阵图）与配色方案（缤纷 / 经典 /
  彩虹 / 切换 / 活力 / 水粉 / 和风 / 华丽 / 雅致 / 三时），
  印证重写时 `Structure` 与主题调色板的取值来源。
- 「彩虹」配色的 6 条分支连线实测色：
  `#FA8155`（Studying）、`#FFAD36`（Info Presenting）、`#B7C82B`（Note Taking）、
  `#0098B9`（Problem Solving）、`#7574BC`（Planning）、`#A165A8`（Brainstorming）。

### 对照结果（`The_Use_of_Mind_Mapping.xmind`）

| 项 | 原版 XMind DOM | xmind-rs (`doc_layout`) |
| --- | --- | --- |
| `content.json` 主题对象 | 90（1 root + 89 attached） | 文档模型加载 90 |
| 状态栏 | `Map 1 / 主题: 1 / 90 / 61%` | — |
| 可见主题 | 82（85 个 `foreignObject` 减去 3 个折叠徽标数字） | **82** |
| 连线 | 6 色 SVG path | 81 条 edge |
| 左右分布 | 左 40 / 右 44（含中心与徽标） | 左 38 / 右 44 |

90 → 82 的差额来自 3 个 `branch: "folded"` 分支（`Directions`、
`Preparation`、`Demand Analysis`）折叠掉的 8 个子主题；原版同样不渲染它们。
逐集合 diff 后，**82 个主题文本一一对应，无遗漏、无多余**。

两处表面差异均非数据问题：

1. 中心主题 DOM 文本显示 `The Use Of Mind Mapping`，文件里是
   `The Use of Mind Mapping` —— 原版渲染层做了 Title Case，写回文件仍用原值。
2. ` Controlling` 的前导空格是原文件自带；对照脚本对原版文本做了
   `trim()`、对 `doc_layout.title` 没有，两边实际取值相同。

结论：**文件格式保真 + 渲染语义（节点集合、折叠行为、左右分支）一致**。
像素级布局与配色按设计不同（Rust 自研布局引擎 + 自有调色板），
这正是重写版不加载原版 166 MB 前端资源的前提。
另外 xmind-rs 自带 `--remote-debugging-port=9223`（WebView2），
可直接 `Runtime.evaluate` 读 DOM 并调 Rust IPC，可观测性优于原版。

## 8. 原版顶栏 / 格式面板的权威规格（2026-11-13 CDP 实测）

原版以 `--remote-debugging-port=9222` 启动后可直接读 DOM，以下数值全部来自
`getBoundingClientRect` 与 `getComputedStyle`，窗口内容区 1408×826。

### 8.1 顶栏（`.uk-workbench-top-bar`，高 52）

* 结构：`[汉堡菜单 32×22 @x13] [文档名 13px/400] [flex] [工具组] [flex 179]
  [ZEN][演说] [flex 89] [格式] [24px] [窗口控制 132×21 @y1]`
* **没有撤销/重做、没有新建/打开/保存/导出**，这些都在汉堡菜单里。
* 工具项 wrapper `32×32`，内部 `button 32×22` + `label 11px/16.5px`；
  内容总高 38.5 溢出 32 的 wrapper 并向上偏移 3.25px（实测 button y=7.8）。
* 图标 20×20，按钮间距 16px（由 16px 的 `item-placeholder` 撑开）。
* **组与组之间没有分隔线**，只有弹性空白（实测 296.5 / 178.5 / 89.3）。
* 主工具组因此落在窗口中心（组中心 707.5 / 窗口 1408）。
* 插入按钮 40×22（带下拉箭头），其余 32×22。
* 窗口控制区 132×21 贴右上角 y=1，三键各 44×21。

### 8.2 格式面板（`.uk-workbench-right`，268 宽）

* 面板 268×773，`#F5F5F5`，左边框 `1px rgba(0,0,0,.05)`。
* 顶部胶囊 tab 条 **28px**（padding 4），三 tab 各 86.67×20：
  选中 `#0F66DE` + 白字 + 13/500；未选中 `rgba(0,0,0,.5)` + 13/600。
  tab 条下 1px `rgba(0,0,0,.05)` 分隔线。
* 分区 `padding: 16px 20px`（内容宽 228）；分区之间 1px 全宽线，
  与前后各留 4px；分区内多个折叠组之间 1px 220 宽线，上下各 16px。
* 折叠头 23px：chevron 16×16（`margin-left:-5px; margin-right:4px`，
  折叠时 `rotate(-90deg)`，`opacity .5`），标题 **13px/700 #27292A**，
  右侧可选 65×22 控件。
* 折叠内容 `padding-top: 12px`；行高节奏 **35px**（23 控件 + 12 间距）。
* 列宽：`[label 75] [153]`，`153 = 78 + 10 + 65`；无 label 时 `153 + 10 + 65 = 228`。
* 控件：高 22、圆角 4、白底、13/500，带
  `0 .5px 1px rgba(0,0,0,.1), inset 0 0 1.5px .25px rgba(0,0,0,.4), inset 0 0 2px .25px rgba(0,0,0,.05)`。
  下拉左侧留 8、右侧留 20 给箭头；数值框右侧有 `PX` 10px/600 `#949699`。
  禁用态 `#FAFAFB` / `#BEBFC0` / 边框 `.5px #E8E8E8`。
* 颜色井 65×22，圆角 4，直接以当前色作底色。
* 分段控件：容器白底 23 高、圆角 4，分段高 22；选中 `#0F66DE` 白字。
  文本组 4 段各 57，对齐组 3 段各 76。
* 复选框 14×14 圆角 3，选中 `#0F66DE` + 白勾，标签 13/500 左距 6。
* 页脚 55px：16 内边距 + 22 高按钮，按钮为**透明底**、
  `.5px rgba(0,0,0,.1)` 边 + `0 0 2px rgba(0,0,0,.2)` 阴影。
* 分区顺序：形状（填充/宽度）｜边框｜文本（字体/字号/粗细/颜色/字符样式/对齐）｜
  结构｜分支（线条/终点/分支样式/彩虹分支）。

### 8.3 状态栏（33px）

* 1px `rgba(0,0,0,.05)` + 30px 行（padding 4，内容 22）。
* 左侧为画布胶囊 tab（22 高，选中 `rgba(0,0,0,.08)` + 黑字 + 13/500）。
* 右侧依次 `主题: 1 / 90`、`−`、`61%`、`+`、`大纲`。

### 8.4 画布滚动条

原版在大图时于画布右缘与状态栏上方显示 10px 沟槽内的 6px 圆角滑块，
xmind-rs 已按同尺寸实现为覆盖式滚动条，可拖拽平移。

## 9. 格式面板三个页签的真实内容（2026-11-14 CDP 实测）

第 8.2 节只记了「胶囊 tab 条」本身，没有记三页签各自装什么 —— 这是此前
实现偏差最大的一处。三页签不是同一份内容的三种视图，而是三套完全不同的面板。

### 9.1 tab 条

* `ul.uk-tab.uk-tab-capsule`：`display: grid`，268×28，`padding: 4px`，三列等分
  （各 86.67 宽），每项 `<li><a>`，`a` 高 20、`padding: 0 12px`、`border-radius: 4px`、
  `line-height: 22px`。
* 未选中：`rgba(0,0,0,.5)` / 13px / **600**；选中：`#0F66DE` 底 + 白字 / **500**。
* **分隔竖线**来自 `.divider-vertical::before`：`1px solid rgba(0,0,0,.15)`、
  `top: 25%`、`height: 50%`（20px 的 tab 上即 5px 起、10px 高）。
  首项带 `divider-vertical-clear`（自身无），激活项带 `divider-vertical-active`
  （自身无），且 `active + .divider-vertical` 也清除 —— 合起来的规则是：
  **某 tab 左侧有线，当且仅当它不是首项、它自己未激活、它前一项也未激活。**

### 9.2 「样式」页签（选中主题时）

| 分区 | 内容 | 高度 |
|---|---|---|
| 1 | 形状（填充 / 宽度）+ hr + 边框（线型 / 颜色） | 214 |
| 2 | 文本（字体+字号 / 粗细+颜色 / 4 段字符样式 / 3 段对齐） | 189 |
| 3 | 结构（228 下拉） | 90 |
| 4 | 分支（线条+终点 / 分支样式 / 彩虹分支） | 176 |

* 形状/边框/结构/分支的折叠头右侧都有 **65×22 的 popover 按钮**（图标 + 右下箭头），
  这使折叠头高 23；「文本」无右侧控件，折叠头高 18。
* 填充行：`label 75` + `78 图标按钮` + `10` + `65 颜色井`；宽度行：`75` + `78 数值(PX)` + `10` + `65「适合」`（禁用态）。
* 文本页签的 4 段字符样式每段 57，3 段对齐每段 76。
* **默认没有「重设样式」**：该块在未改动样式时是 `0×0`（外层容器隐藏），
  只有主题带自有 style 时才出现。

### 9.3 「演说」页签（`.uk-format-panel.uk-slide-panel`）

* 分区 1（174，`padding: 16px 20px 0`）：「演说模式预览」13/700 + **228×128 黑底预览**
  （margin-top 12）。
* 分区 2（309）：「更换风格」228×22 白底扁平按钮 → 12px →「长宽比」+85 下拉 →
  hr 16/16 →「主题幻灯片」+85 → hr →「列表幻灯片」+85 →
  「演说方式」11px 小标题 + 228 下拉 →「布局」11px 小标题 + 5 段各 46。
* 行是 `justify-content: space-between`，标签自动宽，控件固定 85 靠右。

### 9.4 「画布」页签

* 分区 1（527）：骨架（228×60 卡片：71×44 缩略图 + 名称 + 右箭头）→ hr(4/16) →
  配色方案（188 色条按钮 + 8 + 32「+」按钮，其下 3×2 的 69×43 配色缩略图）→
  hr(4/16) → 背景颜色 + 65 颜色井 → hr(4/16) → 全局字体 228 下拉 →
  分支线粗细 228 下拉 → 彩虹分支 + 65 彩色按钮。
* 分区 2（128）「导图样式」13/700 + 三个 checkbox（自动平衡布局 勾选、紧凑型布局、同级主题对齐）。
* 分区 3（128）「高级布局」+ 三个 checkbox（分支自由布局、灵活自由主题、主题层叠）。
* 分区 4（168）「中日韩字体」228 下拉 + 11px 说明（33 高）+ hr(4/16) + 「自定义风格」228×22。

### 9.5 由此修正的实现偏差

* 之前把「演说」「画布」当成两个折叠组塞在「样式」页签底部 —— 结构完全错。
* 之前缺 tab 竖线、缺四个 header 的 65×22 下拉控件、缺骨架卡片与配色缩略图。
* 之前有固定的 55px 页脚，原版没有（重设样式是内容流末尾的隐藏块）。
* 窗口内容区实测 1410×829（此前用 1408×826，导致面板 x 差 2px）。

## 10. 状态栏与大纲模式（2026-11-14 CDP 实测）

### 10.1 状态栏几何

* 容器 `.workbench-status-bar`：高 33（1px 顶线 + 30 行），背景 `#F5F5F5`，仅占画布宽度（右侧面板不吃状态栏）。
* 行容器 padding 4px，flex，左 `uk-width-expand`、右 flex 列。
* 右侧控件（全部 21px 高、13px/500、圆角 4、hover `rgba(0,0,0,.05)`）：
  * 主题计数 `主题: 1 / 5`：73.69×21，padding 0 8；
  * `.statusbar-divider-vertical`：1×11，`rgba(0,0,0,.15)`，`margin: 0 1px`；
  * 缩放按钮：68.59×21，`padding: 0 6px 0 0`，内部 span（padding 0 8）+ 16×16 双 V 图标
    （path `M4.5 5.668L7.715 2 11 5.668M4.5 10.5l3.215 3.668L11 10.5`，stroke #000 1.5）；
  * 另一个 divider；
  * 大纲按钮 42×21；大纲模式下换成 `思维导图` 68×21。
* 左侧：只有一个画布时显示 `画布 1` 纯文本 + 新建按钮（本项目按单画布模式，只保留文本）。

### 10.2 缩放菜单（Electron 原生 Menu，不在 DOM 里）

`handleZoomControlBtnClick` 用 `new Menu()` 弹出 checkbox 型原生菜单：

* 比例表常量 `[500,400,300,200,150,120,100,80,50,20,10]`；
* 菜单项 = 比例表 ∪ 当前值，按数值**降序**，`checked` 表示当前值；
* 之后追加分隔线 + `适应画布`（仅导图模式；大纲模式只保留 80–300% 的比例，无适应画布）。
* 选择后导图走 `zoomScale`，大纲走 sheet 的 outliner zoom。

### 10.3 大纲（Outliner）视图

* `.outliner-mode-container` 覆盖画布区；`.outliner-container` 宽 **650** 居中，`padding-bottom: 100`。
* 中心主题：48 高，`margin: 100px 0 24px`，`padding-left: 22`，背景 `#FAFAFB`，
  标题 **40px/700/48px**，颜色 `rgba(0,0,0,.9)`。
* 主题行 `.outliner-topic-container`：高 30（标题 22 + 上下 4），`margin: 0 -20px 4px`，
  `padding-left: 20 + depth*22`；整行可 hover。
* 行内：`.outliner-topic-dot` 18×18，`margin: 6px 4px 0 2px`；标题 `padding: 4px 22px 4px 0`。
* 字号：一级 **18px/700/22px**，子级 **16px/400/22.4px**；颜色统一 `rgba(0,0,0,.9)`。
* 标记：有子级 → 实心三角（折叠 ▶ / 展开 ▼）；叶子 → 4×4 实心方块。
* 折叠时标题右侧出现子主题数量胶囊徽章（11px、20 高、`#F2F2F3` 底、`#767676` 字）。
* 层级引导线：`.outliner-topic` 上 22px 宽的背景虚线图，位于父级 dot 中心正下方。
* 大纲模式状态栏计数改为 `字数: N`（所有主题标题字符数，不计空格），右侧按钮变 `思维导图`。
* 大纲模式下工具栏换成 撤销 / 减少缩进 / 插入 / 标记（本项目暂未实现该切换）。

## 11. 右侧格式面板的交互与弹层（2026-11-14 CDP 实测）

本节是把右侧栏「大部分控件不可操作」修成可用 + 像素级还原的取证记录。
所有数值来自运行时 `getComputedStyle` / `getBoundingClientRect`（脚本：
`scripts/pop-metrics.mjs`、`scripts/pop-classes.mjs`、`scripts/pop-query.mjs`）。

### 11.1 面板骨架

* `.uk-format-panel` 宽 **268**，自顶向下：页签条（28 高，4 padding，3 个 20 高按钮，
  相邻未选中页签之间才有 1×10 分隔线）、1px 全宽分隔线、可滚动内容区。
* 每个分区 `.uk-format-panel-section`：padding **16 20**，区块之间 1px `rgba(0,0,0,.08)`。
* 折叠头 17（纯标题）或 23（带 22 高控件）高；右侧控件一律 **65×22** 的
  `.uk-button-popover-toggle`（图标居中于左侧 45px，右下 16px 箭头）。
  折叠头图标尺寸：形状/填充/边框/分支线/端点 = **18×22**；结构 = **22×18**
  （`structures/small/*.svg`，会随当前骨架变化）。
* 行节奏：`.uk-form-row` = 23 高控件 + 12 内边距 = **35**；带 11px 小标题的两行
  （分支的「线条 / 终点」）为 18 + 22 + 12 = 52。

### 11.2 四类弹层（全部圆角 10、背景 `rgba(255,255,255,.7)`、`backdrop-filter: blur(30px)`）

| 类名 | 尺寸 | 内边距 | 内容 |
| --- | --- | --- | --- |
| `.uk-pop.uk-popover` + `.popover-list`（瓦片库） | 形状 **285**×560；填充/边框/分支线/端点 **210** | 形状 `16 32 16 20`（右侧 32 留给 overlay 滚动条）；其余 `16 20 20` | 瓦片 `66×40`（margin 4，列距 74/行距 48，3 列）或 `75×40`（margin 5，列距 85，2 列） |
| `.uk-popover-contextual` + `ul.uk-menu`（列表菜单） | 见 11.2.1 | `ul` padding `5px 0` | 行 27 高，按钮 `6px 28px` |
| `structure-popover-cls-offset`（结构库） | **240**×364 | `20px 0` | 行 **36** 高 `0 20px 0 16px`，勾 16、缩略图 48×28、名称 13/500 |
| `uk-color-well-popover`（颜色） | **257**×250 | `8` | 9×5 网格、hex 行、最近使用 |
| `colorful-branch-popover-container`（分支配色） | **184**×192 | `20` | 3 列 40px 圆盘、gap 16×12 |

* 瓦片库底部「无填充 / 无边框」按钮：**170×22**（= 210 − 2×20），`margin-top: 16`，
  白底圆角 4，13/500。
* 菜单阴影挂在内层 `ul` 上：`0 8px 15px 6px rgba(0,0,0,.2), 0 1px 4px 0 rgba(0,0,0,.15),
  inset 0 0 2px 0 rgba(255,255,255,.3)`；`.uk-pop` 自身 `box-shadow: none`。
* 弹层朝向按可用空间切换：`uk-popover-bottom-right / -bottom-left / -bottom-center /
  -top-right / -left-top / -left-center / -left-bottom`（贴视口翻转）。

#### 11.2.1 列表菜单的实测宽度

| 菜单 | 宽 | ul padding | 行内边距 |
| --- | --- | --- | --- |
| 字号（`.uk-menu-compact`） | **72** | `4px 0` | `6px 4px`，左对齐 |
| 字重 | **153** | `5px 0` | `6px 28px` |
| 文字大小写 | **150** | `4px 0` | `6px 8px 6px 24px` |
| 分支线样式 | **172** | `5px 0` | `6px 28px`（只画 116×12 线型图，无文字） |
| 边框粗细 / 分支线粗细 / 结构布局 | **228** | `5px 0` | `6px 28px` |
| 字体 / 全局字体 | **264** | `5px 0` | `6px 28px` |

* 选中态：`background: rgb(15,102,222)`、文字 `rgb(250,250,251)`、`font-weight: 500`。
  弹层一打开时**第一行**就是蓝底（键盘 focus），当前值另由 `uk-checked` 表示。
* `uk-checked` 的勾在 `::before`：left 0、22×27、居中 16px 勾图；所以所有行左内边距 28。
* 分隔线：`li.uk-menu-divider` 高 1、`margin: 4px 0`；文本大小写菜单内用
  7 高的 li 包 1px `hr`（`margin: 3px 0`），线色 `rgba(0,0,0,.05)`。

### 11.3 颜色弹层细化

* `.uk-color-picker-grid`：`grid-template-columns: repeat(9, 25px)`、`gap: 2px`，
  9×5 = 45 色，总 **241×133**；色块 25×25、圆角 0、内描边 `inset 0 0 0 .5px rgba(0,0,0,.1)`。
* 自定义行 241×22（`margin-top: 5`）：hex 框 **127×22**（圆角 4、白底、内置 14px # 图标、
  输入区左内边距 20）→ 1×11 分隔竖线（`margin: 0 6px`）→ 不透明度输入 31 宽居中 → `%` 11 宽；
  再 8px 之后 **22×22** 预览块（圆角 1）；最右 **20×20** 取色圆环。
* 分隔线 1px `rgba(0,0,0,.05)`、`margin: 4px 0`，横跨整个弹层宽度（在 8px 内边距之外）。
* 「最近使用」标题 13/400、行高 19.5、下间距 4；色块同样 25×25 gap 2。

### 11.4 控件的真实结构（纠正早期理解）

* **结构区只有一个下拉**：显示「不平衡 / 顺时针 / 逆时针」（竖向骨架则是「向下 / 向上」，
  逻辑图/树形图/鱼骨图是「向右 / 向左」），标题 `设置结构布局。`，
  菜单只有 2–3 项；折叠头的 65×22 开关打开的才是 **240 宽的骨架库**（9 项）。
* **文本区**：字体 153×22 + 字号 65×22（数字输入 + 24px 双箭头）／字重 153×22 + 颜色 65×22／
  B、I、S 各 **57×22** 段 + Aa 57×22（带 16px 下拉）／对齐 3×**76×22**。
* **分支区**：「线条」153 与「终点」65 各带 11px 小标题；线宽 228 全宽，
  5 档粗细 + 5 档「线条渐细」；彩虹分支为 14×14 复选 + 52×13 说明 + 65×22 圆盘开关。
* 三个颜色井的 tooltip 都是 `点击选择颜色。`；字号下拉是 `设置字体大小。`。

### 11.5 样式落点（写回文件时用的键）

`shape-class`、`svg:fill`、`fill-pattern`、`border-line-color/-width/-pattern`、
`fo:color / -font-family / -font-size / -font-weight / -font-style / -text-decoration /
-text-align / -text-transform`、`line-class / -color / -width / -pattern / -tapered`、
`arrow-end-class`、`svg:opacity`。
画布级设置写在文档上：`background`、`font-family`、`line-width`、`rainbow`、`compact`。

### 11.6 自研侧实现与实测

* 组件：`src/inspector/Inspector.tsx`（面板 + 23 种弹层）、`Popover.tsx`
  （Popover / Menu / TileGrid / ColorPicker）、`tiles.ts`（瓦片与枚举）、
  `public/tiles/*.svg`（81 张，`scripts/dump-tiles.mjs` 从运行中的原版 DOM 导出）。
* 弹层样式：`src/styles.css` 末尾「popovers」段，数值全部对齐 11.2–11.3。
* 画布默认背景实测为 `#ffffff`（`.sheet-viewer`），`layout.theme.bg` 现在真正驱动画布底色，
  选过背景色后立即生效。
* 端到端脚本 `scripts/mine-panel-e2e.js`（CDP 9223，逐个控件点开后读画布）实测通过：
  形状、填充图案、填充色、边框图案/粗细/颜色、文字颜色/字体/字号/字重/大小写/加粗/斜体/
  删除线/对齐、分支线形状/线型/端点/粗细/渐细、彩虹分支、画布背景、全局字体、分支线粗细、结构切换。
* 紧凑布局 / 同级主题对齐 / 九种分支配色 / 演说页签与演说模式 / 括号图、树型表格、
  矩阵图三种骨架已在 2026-11-14 补齐，几何与菜单项见第 12 节。

### 11.7 骨架缩略图的正确素材（2026-11-14 补）

`dump-tiles.mjs` 早先把 **勾选图标**（16×16 的 `M4.48 8l3.02 3 4-7`）当成了骨架缩略图，
于是骨架库 9 行都显示成「✓」。真实素材有两套，都在 `app.asar` 里：

| 用途 | 路径 | 尺寸 |
| --- | --- | --- |
| 骨架库行内缩略图 | `static/assets/images/structures/normal/*.svg` | **48×28** |
| 折叠头 / 结构区下拉图标 | `static/assets/images/structures/small/*.svg` | **22×18** |

正号图的文件名与骨架枚举一一对应：`balanced-map-clockwise / logic-right / brace-right /
org-down / tree-right / timeline-h / fishbone-r / tree-table-row / matrix-row`。
`node scripts/inspect-asar.mjs extract 'static/assets/images/structures/normal/.*\.svg$' target/struct-normal`
一次取出 22 张，覆盖 `public/tiles/skeleton-*.svg`（保持 `tiles.ts` 里的 9 个文件名不变）即可。

**画布页签的骨架卡片**（`.fp-bone`，228×60，缩略图 71×44）在原版里 **不是静态素材**：
卡片 `<img>` 的 `src` 是运行时生成的 `data:image/svg+xml,...`，内容是当前骨架的一张
**浅灰线框迷你图**（居中 21×7 的大块 + 左右各 3 个 15×4.5 的小块，连接线 `#d2d2d2`），
所以它随骨架变化、且与配色主题无关。自研侧用官方 48×28 结构图标做 **灰色蒙版**
（`background: #e5e5e5` + `mask-size: 62px 36px`）复现同样的「淡灰示意图」观感，
差别只在于原版是实心小块、我们是同结构的描边剪影。

顺带两处小修：骨架卡片右侧是**单向下箭头**（不是上下双箭头）；改骨架后画布页签的
卡片图、名字、缩略图会同步更新（三者共用 `skeletonValue`）。


## 12. 紧凑布局 / 同级对齐 / 分支配色 / 演说页签 / 三种骨架（2026-11-14）

### 12.1 「演说」页签的真实菜单项（CDP 9222 实测）

| 控件 | tooltip | 菜单项（顺序即原版顺序） | 菜单尺寸 |
| --- | --- | --- | --- |
| 更换风格 | `请为演说模式选择不一样的风格。` | 浅色 / 深色 / 缤纷童趣 / 雅致色块 / 午夜玫瑰 / 灵动气泡 / 手绘涂鸦 | 276×412 |
| 长宽比 | `设置幻灯片长宽比。` | 自动 / 16:9 / 4:3 / 9:16 / 3:4 | 160×148 |
| 主题幻灯片 | `选择是否在演说模式中将此主题作为幻灯片。` | 自动 / 显示 / 隐藏 | 160×82 |
| 列表幻灯片 | `选择是否在演说模式中将此主题作为幻灯片。` | 自动 / 显示 / 隐藏 | 160×82 |
| 演说方式 | `选择演说模式中列表幻灯片的演说方式。` | 逐一出现并钻入 / 逐一出现 / 一次性出现 | 228×82 |

* 风格弹层是 **两列 112×63 缩略图 + 13px 标题**，图片来自
  `static/images/pitchmode/theme/16_9/<style>.svg`（已解包到 `public/pitch/*.svg`），
  默认选中 `dark`；标题居中在缩略图下方。
* 顶部「演说模式预览」是一个 **227×127、圆角 10、带两层阴影** 的实时渲染画布
  （内部 1600×900 缩放到 0.142），不是静态图。
* 之前假设的 `16:10` / `总是·从不` / `直接跳转` / `default` 全部是错的，已按实测改写
  （`PitchSettings` 的默认值同步为 `auto/auto/drill/dark`）。

### 12.2 三种骨架的几何（原版实测 + 自研实现）

* **括号图 brace-right**：列距 138、行距 26；父子之间一条大括号（`Q` 曲线 + 8px 圆角），
  父右边缘到括号尖有短线，括号到每个子主题各一条横线；**没有 edge**，全部走装饰层。
  自研 `build_braces()` 生成单条复合 path（`Q … , … L … Q … Q …`）并压进 `Layout.decor`。
* **树型表格 treetable**：表头行 86 高、跨全宽；行高 52；列宽比约 1:1.65:3
  （列起点 = 主题自然宽 + 60）；表头下一条横线，同行父子间竖线，颜色随分支。
  自研把每个主题做成 `cell` 节点（透明填充、左对齐、无形状），递归分配行跨度后
  逐格画 `M x y H x+w V y+h H x Z`。
* **矩阵图 matrix**：顶部横幅 56 高（`org.xmind.ui.spreadsheet`），每个一级主题居中作列头，
  二级主题在列内水平展开并垂直堆叠，列间竖线；自研横幅同样是 `cell` 节点。

### 12.3 排版参数化

`Metrics { h_gap, v_gap, sub_gap, row_gap, pad }`，`Metrics::new(compact)` 收紧间距并把
`pad` 压到 0.7；`Metrics::brace(compact)` 单独收紧括号图。紧凑布局生效实测：
根主题 178×70 → 161×61，一级主题 121×44 → 110×38，二级 44 → 38。

`同级主题对齐` = `apply_alignment()`：**按 `depth` 全局**取最大宽统一，左侧节点反向移动 `x`。
早期实现按 `(depth, side)` 分组，2026-11-16 用原版 width-probe 实测后改为全局
（见 §30）；水平骨架的 `Columns` 也同步按 depth 统一，否则扩宽后列间距会错位。
两种水平布局（含括号图）都参与；竖向布局（orgDown/orgUp）不参与；浮动子树、
summary / callout 在主树之后单独摆放，不参与对齐（原版同样不统一它们的宽度）。

### 12.4 一个长期隐藏的渲染 bug

`.node` 里的形状是一层 **绝对定位的 `<svg>`**，按 CSS 绘制顺序会盖住文档流里的
`.node-title`，于是导图上只剩彩色空块（只在缩放后偶然露出部分文字）。
修复：`.node-title { position: relative; z-index: 1; }`。

### 12.5 演说模式

`src/shell/PresentView.tsx`：封面（中心主题）+ 每个一级分支的主题页 / 列表页，
`主题幻灯片`/`列表幻灯片` 决定是否生成，`演说方式` 决定要点是否逐条出现；
`长宽比` 决定幻灯片比例（1600×900 / 1400×1050 / 900×1600 / 1050×1400），
`布局` 1–5 用 `layout-N` 类改内部排布。键盘 ←/→/↑/↓/空格 翻页、Esc 退出、
点击左右半屏翻页；面板与工具栏「演说」（Ctrl Alt P）都能进入。

## 13. 「骨架」不是下拉列表，是九组 43 张缩略图的分区面板（2026-11-14）

### 13.1 面板真实形态（CDP 9222 实测）

* 触发 `button[title="选择骨架。"]`，弹出 **390×496** 的面板，`uk-popover-left-top`
  （顶部与按钮平齐、向画布一侧展开），圆角 10，`rgba(255,255,255,.7)` + 30px 模糊。
* 面板内部是**连续滚动的一整块**，没有分组切换器；共 **9 组 43 张卡**：

  | 组 | 张数 | 组 | 张数 |
  | --- | --- | --- | --- |
  | 思维导图 | 10 | 时间轴 | 5 |
  | 逻辑图 | 7 | 鱼骨图 | 3 |
  | 括号图 | 4 | 树型表格 | 2 |
  | 组织结构图 | 5 | 矩阵图 | 2 |
  | 树形图 | 5 | | |

* 组标题：`h5`，600 字重，`padding: 0 0 12px 8px`；卡片网格
  `grid-template-columns: repeat(3,1fr); gap: 12px 16px; margin: 0 8px 20px`
  → 卡片实测 **106×65**、列距 122、行距 77。
* 卡片：白底、圆角 8、`uk-card-default` 细边 + 投影，**没有任何文字**；选中卡加
  `uk-active`（蓝色描边）。手绘变体在卡片左上角叠一枚 14px 的
  `static/assets/images/skeleton-panel/skeleton-hand-drawn.svg`。
* **点击卡片后面板不关闭**，只是把 `uk-active` 移到新卡并立即应用 —— 可以连续点着比较。
* 缩略图不是静态文件：渲染器按预设实时生成 `data:image/svg+xml`（801×494），
  所以只能从运行中的应用抓。已抓取到 `public/tiles/skeletons/*.svg`（ASCII 命名）。

### 13.2 43 个预设到底是什么

`renderer/2907.js` 里是「分组 → 预设 id 列表」，`renderer/8846.js` 里每个 id 对应
`{structureStyle: {centralTopic, mainTopic}, theme}`。**一个「骨架」= 结构 + 中心主题形状
+ 一级主题形状 + 分支线型/图案**，同组内的多张卡就是同一结构的形状/线型变体：

```
思维导图 1  map.clockwise + logic.right   roundedRect/curve       + roundedRect/roundedElbow
思维导图 2  map.clockwise + logic.right   roundedRect/roundedfold + underline/bight
逻辑图 1    logic.right                   roundedRect/roundedfold + roundedRect/roundedElbow
括号图 1    brace.right                   roundedRect/roundedElbow
矩阵图 1    spreadsheet.column+logic.right rect/curve
```

手绘变体的共同特征是 `line-pattern: handdrawn-solid` + `fill-pattern: hachure*`。
`structureStyle` 那对 class 正是文件里 `extensions` 的
`org.xmind.ui.skeleton.structure.style` 内容（我们原来固定写 `logic.right`，已改为透传真值）。

### 13.3 自研实现

* `scripts/dump-skeleton-thumbs.mjs` → 43 张缩略图 + `research/skeleton-cards.json`
* `scripts/extract-skeleton-presets.mjs` → `research/skeleton-presets.json`（形状/线型/图案）
* `scripts/build-skeleton-data.mjs` → `src/inspector/skeletons.ts`（分组、排序、结构映射）
* 新命令 `doc_apply_skeleton`：一次写入 structure、中心主题形状/线型、一级主题形状/线型/图案
* 面板 `.pop.is-skeleton`：390 宽、496 高、三列 106×65、组标题 16px/600、选中 3px 蓝环、
  左上角手绘角标；点击后**不关闭**（与原版一致）
* `Popover` 新增 `align="top"` 与 `height`：空间不足时整块上移而不是被压扁
* 渲染修正：`line-pattern: handdrawn-*` 不再被当成 stroke-dasharray（否则浏览器丢弃属性）

### 13.4 两个容易做错的细节

* 面板的滚动条是 `uk-overflow-overlay`（覆盖式、不占布局宽度），所以内容宽正好 366，
  三列 106 + 两道 16 的间隙 = 350，左右各留 8。我们用固定 `repeat(3,106px)` +
  `justify-content: space-between` 复现，避免 Windows 滚动条把卡片挤成 101。
* **重开面板不会自动滚到当前选中的骨架**（实测 `scrollTop` 仍是 0，active 卡在视口外），
  所以不要画蛇添足地 `scrollIntoView`。
* 顺带修正括号图：括号尖原来算在 `first.x - 6 - 11 - 8`，正好被父主题右边缘的 ±8px
  折叠圆盘盖住；改为「尖落在 gutter 中点（`parent.right + gap*0.5`）、括号宽 `2*span`
  （`span = gap*0.2` 夹 4–10）、圆角半径 = span」。紧凑模式下 gap 26，括号自动收窄但仍可读。

## 14. 「配色方案」同样是左侧分类色带面板，不是一个下拉菜单（2026-11-14 CDP 实测）

第 13 节把骨架做成九组缩略图后，画布页签里同一列的「配色方案」仍是四项菜单，
与原版不符。本节是把它改成原版形态的取证与实现记录。脚本：
`probe-theme-panel.mjs` / `probe-theme-colors.mjs` / `probe-theme-styles.mjs` /
`probe-theme-apply.mjs` / `probe-theme-hover.mjs`。

### 14.1 面板真实形态（`uk-popover-left-center`）

* 触发控件 `button[title="选择配色方案。"]`：**188×32**，`padding: 8px 24px 8px 12px`，
  内部 `.color-list-preview` 六个 **12×16** 色块 + 方案名 + 右端 4px 箭头；
  右侧 `+` 按钮 **32×32**（`title="新建配色方案。"`）。
* 弹层 **316×370**，圆角 10，`rgba(255,255,255,.7)` + `backdrop-filter: blur(30px)`，
  贴按钮左侧（面板右边 ≈ 按钮左边 − 6），垂直居中。
* 顶部 `.uk-tab.uk-tab-capsule`：高 **30**、padding **4**、两等分 **154×22**、圆角 4、
  13px/**600**。未选中 `rgba(0,0,0,.5)`；**选中是 `rgba(0,0,0,.08)` 浅灰底 + 黑字**
  （和右侧面板那个蓝底胶囊不是同一套样式），下面一条 1px 分隔线。
* 内容：左右 20、顶部 19；组 **130×44**（标题 16 + 4 + 色带 24），列距 146、行距 60。
  色带圆角 **2**，默认阴影 `0 1px 2px rgba(0,0,0,.1), 0 1px 6px rgba(0,0,0,.1)`；
  选中加 `0 0 0 3px #0f66de`；hover 出「切换」覆盖层（`rgba(0,0,0,.2)` + 白字 13）。
* 组标题 **13px/500**、`#27292a`。
* **点色带不关闭面板**，只移动蓝色高亮并立即把配色刷到画布；触发按钮文本同步变成方案名。
* 23 组时内容高 743，需滚动；滚动条是覆盖式的，否则 154 的 tab 会被挤成 147。

### 14.2 32 组色值的真值（`renderer/2907.js`）

| 结构 | 内容 |
| --- | --- |
| `_=[R.Rainbow, R.Energy, …]` | 缤纷 23 组的顺序 |
| `F={[R.Energy]:[…]}` | 缤纷每组 6 色 |
| `A=[y.Classic, …]` | 经典 9 组的顺序 |
| `I={[y.Classic]:[…]}` | 经典每组 6 色 |
| `L=[[6 色]×6]` | 彩虹卡面上的 6 组三段渐变（取每行 0/2/4 色） |

中文名与面板 DOM 顺序一一对应：

* 缤纷（23）：彩虹 活力 水粉 和风 华丽 雅致 三时 炫彩 复古 甜点 香草 糖果 绿茶
  霓虹 宇宙 樱花 壁炉 假日 海洋 岛屿 紫藤 玫瑰 薄荷
* 经典（9）：永恒 奶油 花海 珊瑚 绚丽 香槟 香水 禅心 律动

**6 个色值有固定角色**：0 = 背景、1 = 次级面、2..4 = 一级分支循环、5 = 中心主题。
实测点「活力」后中心主题变 `#0D0D0D`，四个分支是 `#F22816/#F2B807/#233ED9/#F22816`
（红黄蓝红，2 红 1 黄 1 蓝），与从数组推出来的分配完全一致。
「彩虹」是特例：分支用 `L` 两行拼成的 **12 色环**，中心 `#245570`。

### 14.3 自研实现

* `scripts/build-palette-data.mjs` → `src/inspector/palettes.ts`（32 组、彩虹 strips/cycle、
  `paletteById` / `paletteByColors` / `paletteBranches` / `paletteCenter`）。
* `Document` 增 `palette`（方案 id）与 `center_color`；`doc_set_canvas` 透传。
  `layout.rs` 用 `center_color` 覆盖中心填充，并新增 `readable_on()` 按 YIQ 亮度
  在黑/白之间挑文字色——中心与一级分支都用它（否则深色方案会出现黑底黑字）。
* 面板：`Inspector` 的 `theme` 弹层改为 `.pal-board`（胶囊 tab + `.pal-scroll` 两列网格）；
  `Popover` 新增 `align="center"` + `side="left"`，并固定 `height: 370px` 让内层滚动。
* 右侧「配色方案」行：6 个 12×16 色块 + 方案名（无方案时「默认」/「自定义」）；
  3×2 快速卡改为六个方案的小色带示意，点击即应用。
* 分支配色与配色方案互斥：点分支配色时同时清空 `palette`/`centerColor`。

### 14.4 实测（CDP 9223）

* 面板 316×370，tab 154×22，组 130×44，缤纷 23 / 经典 9，滚动区 340 可滚到 743。
* 活力：中心 `#0D0D0D` + 白字，分支 `#F22816`(白) `#F2B807`(黑) `#233ED9`(白) `#F22816`(白)。
* 禅心：中心 `#080808`，分支 `#D3D3D3`(黑) `#393939`(白) `#202020`(白)。
* 彩虹：中心 `#245570`，分支 `#F9423A #F6A04D #F3D321 #00BC7B`。
* 点击后面板保持打开、触发按钮改名、快速卡同步高亮；分支配色后按钮回到「自定义」。

## 15. 收尾三笔欠账：配色落盘、快速卡缩略图、手绘纹理 / 矩阵列头（2026-11-14 晚）

### 15.1 配色方案写在 `sheet.theme` 里，不是我们自己的字段

拿一份真实 `.xmind` 拆开看（`unzip -p 文件 content.json`），配色集中在 sheet 的
`theme` 对象中，与我们 §14 的"6 色角色"一一对应：

| 位置 | 含义 |
| --- | --- |
| `theme.colorThemeId` | 当前选中的方案 id（面板高亮用） |
| `theme.map.properties["color-list"]` | 一级分支循环色，空格分隔 |
| `theme.map.properties["multi-line-colors"]` | 同上（多行布局用） |
| `theme.centralTopic.properties["svg:fill"]` | 中心主题填充 |
| `theme.centralTopic.properties["fo:color"]` | 中心主题文字色 |

原版的 id 是**算出来的**：`renderer/2907.js` 里 `generateSmartColorThemeId()` 拼
`${themeName}-${baseColor}-${type}`（例如 `活力-#F22816-Dazzle`），所以没有一张静态表可抄。
我们自己统一写 `XMindRS-<paletteId>`（`XMindRS-vivid-energy`），读回时去掉前缀即可还原；
遇到别的 id（真 XMind 存的派生 id）就原样保留，前端再用 `paletteByColors()` 按色环反查名字。

另外 `color-list` 的长度不固定：真 XMind 会把短色环补齐到 6 槽
（`Gp()`：`for(;o.length<6;) o=o.concat(o)`，活力那 3 个分支色写成 6 个），
我们只写真实周期（3 个或彩虹的 12 个）。读回时用 `shorten_cycle()` 求出最小周期，
两种写法都能还原成同一组颜色，`paletteByColors()` 才认得出来。

### 15.2 只在该写的时候写：`palette_dirty`

`Document` 新增 `palette_dirty`（serde 默认 false）。只有 `doc_set_canvas` 收到
`palette` / `centerColor` / `branchColors` 之一时才置 true；`sheet_to_json` 只有它
为 true 才动 `theme`。这样有两个好处：

* 打开真 XMind 的文件、原样保存，`content.json` 仍然**逐字节一致**
  （`every_real_template_content_json_is_byte_faithful` 靠这条通过）；
* 重新打开自己保存的文件时，theme 已经是对的，不会二次改写。

新增测试 `color_palette_survives_roundtrip`：写盘后断言
`colorThemeId / color-list / centralTopic.svg:fill / fo:color`，再读回断言
`palette / center_color / branch_colors` 复原，并且第二次保存逐字节稳定。

### 15.3 3×2 快速卡是整幅小地图

原版那六张卡是"当前结构 + 每个方案"的迷你画布，不是色带。我们把
`scripts/build-palette-data.mjs` 扩成同时产出 `public/tiles/palettes/<id>.svg`：
144×90（= 卡片 69×43 的比例，`object-fit: cover` 不会裁边），
白底 + 中心块 + 三条弯连线 + 三个分支块，文字用 2.4px 的示意横条代替，
横条颜色按 YIQ 亮度在黑/白之间选，深色块上不会看不见。32 个方案各一张。

### 15.4 手绘骨架的纹理填充

`renderer/2907.js` 的 `FILL_PATTERN` 枚举才是真名：
`none / solid / solid-hand-drawn / hachure / hachure-left-hand / zigzag /
zigzag-left-hand / crossing`，骨架预设还会带 `-thin` 变体
（`research/skeleton-presets.json` 里就有 `hachure-thin`、`crossing-thin`）。
之前的 `diagonal-hand-drawn` 之类是自拟名，永远命中不了。

现在：`doc_apply_skeleton` 多收一个 `fill_pattern`，写到一级主题的 `TopicStyle`
上；画布把 `fill-pattern` 渲染成 `<pattern>`（白色底 + 用主题色的斜线/交叉线/锯齿），
并裁在形状内。另外 `line-pattern: handdrawn-*` 时给闭合主题补 2px `#262626` 墨色描边——
原版手绘卡就是"墨水勾边 + 淡斜纹"，没有描边会只剩一层几乎看不见的纹理。

### 15.5 矩阵图列头是整列色带

`compute_matrix` 原来把列头做成"文字宽度的小块"，在宽列里看着像左对齐。
改成 `width = col_w`、`x = col_x`、`align = center`、`pad = col_pad`，
列头就变成横跨整列的色带，与真矩阵表格一致（实测列头 181×44、padding 30）。
列分隔竖线原来从横幅底边（y=56）就往下画，会穿过列头的圆角缺口；现在每列记下
自己的 `head_y + head_h + 2`，竖线从列头下方开始。

### 15.6 实测（CDP 9223，隔离实例）

* 快速卡：6 张全部加载 `naturalWidth > 0`，69×43，`src=/tiles/palettes/*.svg`。
* 配色：点「活力」→ 中心 `#0D0D0D`、分支 `#F22816/#F2B807/#233ED9`；存盘后
  `doc_new` + `doc_open`，按钮名仍是「活力」，颜色逐项一致，`palette=vivid-energy`。
* 手绘「思维导图 6」：一级主题 `fill=url(#hatch-…)`、`stroke=#262626`、`stroke-width=2`。
* 矩阵「矩阵图 1」：四个列头都 181 宽、`justify-content:center`、`padding-left:30px`。

## 16. 分枝连线的真实曲率 + 拖动改层级（2026-11-14 CDP 实测）

### 16.1 原版连线是"两端水平切线"的贝塞尔

之前的 `Curve` 用的是"控制点贴在起点、只偏 0.2·dx"的二次曲线：横向间距小时
（中心→分支只有 30~50px，纵向却有 100px）整条线几乎是直的，只在根部有个小钩，
所以看起来"没有弧度"。

打开原版（`XMind.exe --remote-debugging-port=9222`，任意地图）在编辑页里
`document.querySelectorAll('svg')` 里那个 3954×2593 的大 SVG 就是整张画布，
每条连线的 `d` 可以直接读出来：

```
M 54 0 C 93.75 0, 80.5 -80, 107 -80      // 染色细线（line-class = curve）
M 17.34 0.41 Q 42.2 -361.36, 152 -362    // 锥形分支（line-tapered，填充楔形）
```

细线的两组控制点：`c1 = start + 0.75·dx`（y 与起点齐平）、
`c2 = end − 0.5·dx`（y 与终点齐平）。也就是**两端切线都是水平**的 S 形，
这也是"看起来有弧度"的关键。左侧分支只是 dx 为负，公式不用改。

锥形分支的脊椎是二次曲线：`cp = (start + 0.2·dx, end.y)`——从父主题陡峭地
射出去，进入子主题时转平，和原版那张截图里"从中心向上甩出去"的观感一致。

`crates/xmind-core/src/layout.rs` 现在按这两种形状生成（非锥形走 cubic，
锥形走 quad），`crates/xmind-core/tests/curve.rs` 断言：

* 细线：`c1.x = p0.x + 0.75·dx`、`c2.x = p1.x − 0.5·dx`、两端 y 各与对应端点齐平；
* 有纵向偏移的分支，中点偏离弦长 > 1px（证明它真的弯）；
* 锥形：闭合多边形、轮廓点数 > 120（沿脊椎采样，而不是四点多边形）。

### 16.2 拖动改层级 + 预测线条

原版按住主题拖动时，会（实测截屏 + DOM diff）：

1. 给被拖主题加蓝色虚线环，整棵子树降透明度；
2. 悬停的目标主题加描边环；
3. 在"会落到的位置"画一个虚线幽灵主题；
4. 幽灵与目标之间连一条虚线，就是预测线条；
5. 落在同级之间时改画一条插入横线。

我们的实现（`src/editor/MapCanvas.tsx`）：

* 弃用 HTML5 drag&drop（拿不到坐标也不好画预览），改 `pointerdown` +
  4px 阈值判定拖动，`setPointerCapture` 保证移出窗口也能收到 `pointerup`；
  `Escape` 取消，拖完抑制紧随其后的 `click`。
* 命中测试在 stage 坐标系里做，排除被拖主题及其子树（用 `collectSubtree`），
  多个主题重叠时取面积最小的那个。
* 目标主题上/下 28% 算"插到同级前/后"，中间算"变成子主题"。
* 预测线条复用布局同一套曲线公式，从目标的**出枝方向**（右侧主题取右边缘，
  左侧取左边缘，纵向结构取上/下边缘）连到幽灵的对应边，所以预览就是真实分支。
* 幽灵落在"追加到最后一个子主题之后"的位置；没有子主题时与父主题同高。
* 同级插入的序号必须用**文档顺序**，不是视觉顺序——顺时针布局左半边是自下而上，
  两者不一致。为此 `LaidOutNode` 新增 `child_index`（`layout.rs` 在递归时写入），
  拖拽时 `index = hit.childIndex (+1)`，同一父级内再按"先摘除后插入"补偿一位。

### 16.3 实测（CDP 9223，隔离实例）

`scripts/ui-drag.mjs`（`doc_new` 起一张干净图 → Tab/Enter 建树 → 拖）：

* 连线：6/6 条都是采样曲线（49 段），不是四点直线楔形；
* 拖「分支主题 1」到「分支主题 3」身上：`分支主题 3 > 分支主题 1`，树正确；
* 拖「分支主题 3」到「分支主题 2」上沿：根顺序变成 `分支主题 3, 分支主题 2, …`；
* 拖动中按 Escape：树不变；
* 两次 `doc_undo` 回到初始树。

原版取数脚本：`node scripts/probe-connector-geometry.mjs`（要求 XMind 开着地图）。

## 17. 骨架 × 配色 的文字对比度（2026-11-14 晚，白底）

### 17.1 问题不是「配色选错」，是文字和它脚下的面不是同一个东西

`style_for()` 原来按 **色块颜色** 给墨色：`readable_on(branch_color)` / `readable_on(pal.center)`。
但有些骨架根本不画色块：

* `shape-class = underline / doubleunderline`（思维导图 2、逻辑图 3、组织结构图 4、
  括号图 2、树形图 2 …）→ `style.fill = "none"`，文字直接坐在白画布上；
* 手绘骨架的 `fill-pattern = hachure / hachure-thin / crossing / crossing-thin` →
  `MapCanvas.hatchPattern()` 铺的是 **白底 `<rect>` + 主题色线条**，平均底色接近白。

于是「深色配色 + 无填充骨架」就成了白字压白底（对比度 1.0）。全量审计里这类
共 1458 个节点，覆盖 41/43 个骨架。

### 17.2 原版怎么选墨色（实测，23.07 build）

`topic-node` 组里 `topic-title div` 的 `style.color` 就是墨色；默认新图四个一级分支
是 `白 / 黑 / 白 / 白` —— 黄底给黑字、红蓝底给白字，即按色块亮度翻转（YIQ 一类）。
所以**有实心色块时不要自作主张改墨色**，否则会和原版不一致（例如 `#F9423B` 白字
WCAG 只有 3.6，原版照样用白）。

### 17.3 修法：按「文字实际落在哪个面」决定

`crates/xmind-core/src/layout.rs` 新增 WCAG 工具（`rgb_of` / `rel_luminance` /
`contrast_ratio` / `blend_over`）与：

* `text_surface(style, pal)` → `(背景色, 是否实心色块)`：
  - `underline` / `fill: none|transparent` → 画布色 `pal.bg`，**不是**色块；
  - `hachure|crossing|zigzag` → `blend_over(fill, #ffffff, 0.22)`（按笔画覆盖率折算平均底色）；
  - 其余 → 色块本身。
* `ensure_contrast(style, pal)`：
  - **实心色块直接返回**（保持原版墨色，红底白字 3.6 也保留）；
  - 其余情况对比度 < 4.5 时，在黑/白里挑对比度更高的那个。
* 只在 **用户没有显式设置 `fo:color`** 时生效（`topic.style.color` 为 `None`）。

顺带修掉一件事：`.node.underline` 原来用 `border-bottom: currentColor`，墨色一翻黑，
下划线就跟着变黑、丢掉分支色。现在节点上带 `--ul: style.lineColor`，
CSS 用 `var(--ul, currentColor)`，文字可以黑、线仍是分支色。

### 17.4 全量审计（`scripts/audit-contrast.mjs`）

43 骨架 × 32 配色 = 1376 组合、9632 个节点，逐节点算 `文字 vs 实际底色`：

| | 低于阈值节点 | 涉及骨架 |
|---|---|---|
| 修复前 | 1458 | 41 / 43 |
| 修复后 | 0 | 0 |

阈值：实心色块 2.0（下限只防「真的糊成一片」），画布/纹理 4.5。
修复后最低的组合是 `白字 on #00BC7B` = 2.48 —— 那是实心色块上原版自己也会用的白字，
按 17.2 的结论保留。1376 格里 944 格 ≥ 4.5、281 格 3–4.5、151 格 2–3（全是实心色块的
原版墨色），没有 < 2 的。逐格热力图：`<out>/report.html`（`matrix.json` 为原始数据）。

回归：`crates/xmind-core/tests/contrast.rs` 四条（下划线翻黑 / 手绘翻黑 /
实心色块保持原版墨色 / 画布变深时深色字翻白），`cargo test` 全绿；
`scripts/shot-contrast.mjs` 走真实面板截图（必须点 UI，直接 IPC 不会触发 React 重绘）。

## 18. 就地改名：编辑时文字不回显（2026-11-14）

### 18.1 症状与根因

双击主题进入编辑后，**输入框里敲什么画布上都不显示，失焦才出现新文字**。

根因是绘制顺序，不是 React 状态：主题盒子里有两层内容 —— 绝对定位的
`<svg class="node-shape">` 和文档流里的文字。绝对定位元素（z-index: auto）
在绘制顺序里排在**普通流内容之后**，于是形状层整个盖住了输入框。
`.node-title` 这个 span 早就写了 `position: relative; z-index: 1` 才没被盖住，
`.node-title-input` 漏了同一条，输入的文字（连同光标）全在形状下面。

诊断依据：`getComputedStyle(input).position === 'static'`、`zIndex === 'auto'`，
而 `.node-title` 是 `relative/1`；输入框 `value` 一直是对的（React 受控正常），
只是画不出来。

### 18.2 修法

* `.node-title-input` 补 `position: relative; z-index: 1`，与被编辑的标题同层；
* `text-align: inherit`（原来硬写 center，左对齐主题会跳）、`caret-color: currentColor`、
  `user-select: text`（`.node` 是 `user-select: none`）、`cursor: text`、`min-width: 0`；
* 下划线主题编辑时也保留分支色下划线：`.node.underline .node-title-input`；
* 进入编辑即全选（`onFocus={e => e.currentTarget.select()}`），照原版「双击后直接替换」；
* 输入框内双击不要冒泡回节点（否则 `onDoubleClick` 会把 `draft` 重置回原标题）。

### 18.3 验证（`scripts/ui-rename.mjs`）

12 条断言全绿：编辑框已聚焦、`position/z-index` 已越过形状层、有可见盒子、
逐字回显（`value`）、每次按键画布重绘（截图字节变化）、Enter 提交后标题为输入值、
Escape 丢弃草稿、失焦提交。

### 18.4 踩坑：验证脚本不能用 `invoke('doc_new')` 造新图

`invoke('doc_new')` 直接打 IPC 会**绕过 React 状态**：后端换成新文档，App 里还是旧
snapshot。之后任何 `run()` 提交都会把旧 snapshot 覆盖成后端当前文档 —— 表现成
「改名后整张图变回默认内容、节点 id 全变」，很容易误判成改名有 bug。
造干净画布必须走应用自己的路径（Ctrl+N → `newFile()`）。

## 19. 就地编辑改为「每次按键都触发后端重排」（2026-11-14）

### 19.1 需求

§18 修掉「形状层盖住输入框」后还剩一个差距：输入框宽度等于**进入编辑那一刻**
的主题宽度，文字变长只能在框内横向滚动。原版 XMind 是边输入边把主题盒子撑宽，
周围连线与兄弟主题同步让位。用户要求走真正的后端重排，不要前端临时撑宽。

### 19.2 链路

双击 → `startEdit` → `doc_edit_begin(id)` 开会话；`onChange` 每键发
`doc_edit_text(id, text)`，后端 `ops::rename` + `compute_layout` 重算整张图并返回
`Snapshot`；App 直接 `commit()`（不走 `run()`，避免每键 setBusy）。Enter/失焦 →
`doc_edit_end(id, title, false)` 写入 trim 后的最终值；Escape → `cancel: true` 回滚。

前端（`MapCanvas.tsx`）用 `draftRef` 同步保存草稿（防 Enter 与最后一次输入同 tick
读到旧 render）、`editIdRef` + `editActive` 防止 Enter 与 blur 重复结束会话、
也防止切到另一个主题时旧 input 的 blur 误关新会话。App 用单调 `liveSeq` +
`liveApplied`，只让序号不小于已应用帧的响应 commit，避免慢响应把旧布局画回来。

### 19.3 编辑会话与撤销（`state.rs::EditSession`）

如果每键都走 `mutate()`，撤销栈会多出几十条，Ctrl+Z 只能一个字一个字退。因此：

* `live_edit_begin` 只快照原 `Document`、原标题、dirty、undo 长度、redo 栈，**不 push 历史**；
* `live_edit_text` 仅在**第一次**按键 push 一次 undo（编辑前文档）并清 redo，之后只改文档；
  会话内不做 HISTORY_LIMIT 裁剪，保证 `truncate(undo_len)` 能精确撤销这一条；
* `live_edit_end`：`cancel` 或最终文字与原标题相同 → 恢复整个原 `Document`（连带
  `titleUnedited`）、`truncate(undo_len)`、恢复 redo 与 dirty；否则写入 trim 后的文字；
* 任何其他 `mutate()` 开头会 `edit.take()`，隐式结束会话但保留文字，
  这样之后的 Escape 不会回滚掉编辑期间做的别的操作；`replace_document` 同样清会话。

### 19.4 验证（`scripts/ui-rename.mjs`，27 条断言全绿）

逐字符 CDP 输入，实测宽度 `150,150,150,178,208,238,268`，DOM 与 `doc_layout` 每帧一致；
后端 title 与输入框 value 同步；缩放/焦点在整个重排过程保持；Enter 提交、**一次 Ctrl+Z
回到编辑前标题**（不是退一个字）、Ctrl+Shift+Z 重做；Escape 前先证实草稿已写进后端
document，Escape 后标题与宽度都回滚；失焦提交正常。`cargo test`、`tsc`、
`build:app`、`ui-drag.mjs`、`ui-verify.mjs` 全部回归通过。

### 19.5 后续

这里提到的 340px 上限与折行缺口，已在 **§20** 补齐（后端按行数增高主题、
`<textarea>` 编辑框、`pre-wrap` 多行显示）。

## 20. 超长标题折行（接 §19.5，2026-11-14）

### 20.1 需求

§19 把宽度钳在 340px 后，超长标题仍是单行 `<input>` 横向滚动、文字被裁，
而原版 XMind 会折行并把主题变高。用户要求补齐这一半。

### 20.2 后端（`crates/xmind-core/src/layout.rs`）

* `char_ratio`（盒宽估算，Latin 0.55em）**保持不变**，短标题尺寸完全不变；
  新增 `wrap_ratio`（空格 .30 / 大写 .68 / 数字 .52 / CJK 1.0 / 其他 .58）
  **只用于折行**。真实 Roboto 大写字母明显宽于 0.55em，沿用盒宽比例会少算一行：
  CDP mirror 实测浏览器折 3 行、后端只算 2 行，textarea 最后一行被裁。
* `title_lines()` 贪心逐字符折行，`\n` 强制换行；折行 limit 用盒宽
  （CSS 里文字元素就是 100% 宽，无额外水平 padding）。
* `node_size()` 的 height 改为 `text_height(size) × lines + v_pad`，
  主题随行数增高；`LaidOutNode.lines` 把行数送到前端，`resize_node()` 也会重算。
* 矩阵/树表的 `cell` 行高固定，CSS 里仍按单行省略，不参与折行。

### 20.3 前端

* `<input>` → `<textarea rows={node.lines}>`：Enter 提交、Shift+Enter 插入真实换行；
  受控草稿、进入即全选、焦点保持、整段编辑一次撤销、Escape 回滚全部沿用 §19 链路，
  `textarea.value` 与这些机制天然兼容。
* `.node-title` / `.node-title-input` 改 `white-space: pre-wrap` +
  `overflow-wrap: anywhere` + `width: 100%`，与后端逐字符折行一致；
  textarea `resize: none; overflow: hidden`，rows 高度贴合文字、父级 flex 垂直居中。
* 下划线骨架的标题保留 `width: auto; flex: 0 1 auto`，下划线仍贴合文字宽度，
  不会被拉满整个主题盒。

### 20.4 验证

* 新增 `crates/xmind-core/tests/wrap.rs` 4 条：短标题尺寸不变、长标题折行增高、
  显式换行算一行、`custom_width` 改变折行上限。
* `scripts/ui-rename.mjs` 扩到 **36 条断言**：340px 内宽度逐字 `150→268`；
  超过后后端 `lines 1→2→3`、`height 70→110→150`，DOM 与后端每帧一致；
  `rows` 跟随行数、无横向滚动、无纵向裁切；提交后 span 多行显示、一次 Ctrl+Z、
  Escape 连标题和高度一起回滚；Shift+Enter 的显式换行也到后端。
* 回归：`cargo test`（含新增 4 条）、`tsc --noEmit`、`npm run build:app`、
  `ui-drag.mjs`、`ui-verify.mjs` 全通过；
  `audit-contrast.mjs` 重跑 1376 组合 / 9632 节点，`failingNodes: 0`（未受影响）。
* **测试稳定性坑**：CDP 带 clip 截图偶尔让 WebView 失焦，textarea 的 blur 会提交草稿
  并关闭编辑器，整轮逐字测试随后全部落空。脚本现在开
  `Emulation.setFocusEmulationEnabled`、把 clip 限制在视口内，并在截图后检查
  编辑器是否仍在（必要时重新双击进入）。

## 21. 折叠按钮、拖拽定位、工具栏占位按钮（2026-11-14）

### 21.1 折叠按钮「不生效」其实是两个独立缺陷

CDP 实测（`target/tools-deliver3`）：

1. **非中心主题的按钮 click 被 pointer capture 抢走**。`.node` 在
   `onPointerDown` 里 `setPointerCapture` 启动拖拽；捕获会把随后的 click
   重定向到 `.node`（实测事件 target 是 `DIV.node`，不是 `BUTTON.fold-badge`），
   按钮的 `onClick` 根本不执行。中心主题因为 `depth===0` 直接 return、不捕获，
   所以只有它是「能用」的。修法：`.fold-badge` 加
   `onPointerDown={e => e.stopPropagation()}`。
2. **折叠状态改了，画面没变**。`compute_layout` 的平衡/顺时针分支把 root 的
   一级分支**逐个**交给 `place_horizontal`，自己手写 root 节点，于是
   `place_horizontal` 里的 `if topic.folded { return; }` 从来没机会检查 root。
   实测点击后 `folded:true / hiddenCount:5`，但 `doc_layout` 仍返回 7 个节点。
   修法：主分支里 `if !root.folded` 才收集/摆放一级分支；矩阵图同样补上
   `if root.folded { break; }` 与列头主题的 `folded` 剪枝（树型表格本来就支持）。

### 21.2 拖拽支持位置调整

拖到画布空白处不再是空操作：XMind 此时会把主题变成**浮动主题**。

* `ops::move_to_free_position(doc, id, x, y)`：从四组子节点里摘出主题，
  放进 `root.detached`，写 `position`（相对中心主题中心的偏移；layout 对浮动
  主题正是这样解释 position）。`move_topic` 拖回树里时把 `position` 清掉，
  避免下次再浮动时跳回旧位置。
* 前端 `DropPreview.mode` 增加 `'free'`：命中不到主题时显示紫色幽灵框 +
  「自由主题」提示，松手按 `ghost 中心 − root 中心` 换算成相对坐标发
  `moveFree`。命中主题时仍走原来的层级/同级排序逻辑，两者不冲突。
* 浮动主题自身继续拖动即可改位置；拖回某个主题即重新挂回树。

### 21.3 联系 / 概要 / 外框 / ZEN 从占位改成真功能

**数据存放**：不改变 Rust 模型结构，直接写进 `sheet.extra` 的 XMind 原生键
（`relationships` / `boundaries`），以及 `children.summary` 里带
`summaryRange` 扩展的真实概要主题。`sheet_to_json` / `topic_to_json` 原样
回写这些键，官方 XMind 能读，自研渲染器也能读；撤销栈整体 clone Document，
因此增删改都自然可撤销。

* 联系：两步手势（工具栏 / Ctrl+Shift+R 选起点 → 点第二个主题 → Esc 取消）。
  `build_decorations` 从两个主题盒边缘取点，画带弯曲的二次曲线 + 箭头 + 标签。
* 概要：`decor_range` 取选中主题的子主题（叶子则取其兄弟）范围，创建概要
  主题；floating 布局循环识别 `summaryRange`，把概要主题放在范围右侧并画
  大括号线。
* 外框：同一范围画圆角虚线框，带可改标题。
* 装饰可点选（透明的 14–16px `decor-hit` 描边）、Delete 删除、双击改标题。
  改名用**应用内输入框**，不用 `window.prompt`（WebView2 里不弹，CDP 收不到
  `Page.javascriptDialogOpening`）。
* ZEN：隐藏标题栏 / 状态栏 / 右侧面板，Esc 或浮动按钮退出；Ctrl+Alt+F 切换。
  Escape 优先级调整为 ZEN → 联系模式 → 装饰选中，保证一次 Esc 就能退出专注模式。

### 21.4 又一个 pointer-capture 坑

`.canvas` 的 `onPointerDown` 原本无条件 `setPointerCapture`（平移手势），
它同样会抢走 `.decor-hit` 的 click，导致「联系线 / 外框点不中」。现在遇到
`.decor-hit` 直接 return：既不平移也不捕获。这与 §21.1 的折叠按钮是同一类
问题 —— **任何要响应 click 的画布内元素，都必须避开祖先的 pointer capture**。

### 21.5 验证

* 新增 `crates/xmind-core/tests/fold.rs`（3 条：中心折叠只剩 1 节点、分支折叠
  只隐藏自己的子树、矩阵/树表结构同样生效）与 `tests/decor.rs`（3 条：联系线、
  概要/外框增删改名、自由位置与拖回清理）。
* 新增 `scripts/ui-tools.mjs`，**33 条断言全绿**：折叠 click target、节点数与
  连线数、展开恢复、拖到空白变浮动并移动、子树跟随、拖回重挂、联系两步创建
  与可命中/删除、概要与外框生成、双击改名、ZEN 与 Esc。
* 回归：`cargo test` 31 项、`tsc --noEmit`、`npm run build:app`、
  `ui-rename.mjs`（36 断言）、`ui-drag.mjs`、`ui-verify.mjs` 全通过；
  `audit-contrast.mjs` 重跑 1376 组合 / 9632 节点，`failingNodes: 0`。
* **测试稳定性**：CDP 在 SVG 描边命中区上合成的双击偶发不触发 React 的委托
  `onDoubleClick`（DOM 的 dblclick 事件确实派发到了 `.decor-hit`）。验证脚本
  分两层：先断言原生 dblclick 到达描边，再显式派发同一事件验证重命名回调。

## 22. 框选多选、按范围建概要与完整菜单系统（2026-11-14）

### 22.1 原版菜单的真实来源是 Electron native menu

主菜单（左上角汉堡）**不在 renderer DOM 里**：`probe-main-menu.js` 在
`.uk-workbench-top-bar` 下只能找到若干 `uk-button-popover-toggle`。真正的菜单
是本进程 Electron `Menu`，通过 webpack module cache 取到：

```js
webpackChunkxmind_vana.push([[999991], {}, (r) => { req = r; }]);
const Menu = req(67657).Menu;          // Electron 22.3.1 / Chrome 108
const app = Menu.getApplicationMenu(); // 完整应用菜单树
```

`Menu.getApplicationMenu().items` 的 `submenu.items` 可直接递归读取；本次重新
抓的完整树落在 `target/app-menu-full.json`（顶层 20 行 + 文件/编辑/插入/工具/
查看/帮助 六个子菜单）。两类右键菜单是运行时动态构建的，用 Hook 捕获：

```js
const orig = Menu.buildFromTemplate;
Menu.buildFromTemplate = function (tpl) {
  window.__menuCapture.push(tpl); return orig.call(this, tpl);
};
```

`target/ctx-menus.json` 保存了画布空白处、中心主题、分支主题三种模板。
其中**中心主题右键没有「展开子主题」行，也没有分支导出组**；分支主题右键多
出「展开子主题 / 导出分支为 / 打印分支... / 仅显示该分支 / 重设位置」；主题右键
的「插入」子菜单只有 10 行元素插入项，且**附件 / 语音备注 / 贴纸 / 插画 / 方程
全部是 enabled**（不是禁用态）。帮助菜单第一项是登录账号
`QiuChenly@52pojie`。这些都是手写菜单最容易搞错的地方。

`enabled` 反映的是捕获时的上下文（窗口未激活、无选中主题、没有折叠），所以
实现里改成按 `MenuContext` 动态计算：选中中心主题时剪切/复制/删除禁用、
分支主题时启用、无折叠时「展开所有子分支」禁用等。

### 22.2 框选的像素规格

`scripts/probe-marquee.mjs` / `probe-summary-range.mjs` 在 2560×1600 视口下用
真实 `Input.dispatchMouseEvent` 多步拖动（**单次 mouseMoved 不形成命中**）测到：

| 元素 | 规格 |
| --- | --- |
| `multi-selection-box` | `fill: rgba(46,189,255,.1)`，`stroke: rgba(46,189,255,.5)`，直角矩形 |
| `topic-outline:*` | `stroke: rgb(46,189,255)`，`stroke-width: 2`，圆角半径 5 的路径 |
| outline 与主题盒 | **四边各外扩 2px**（2026-11-16 复测修正，见 §31.1） |
| 状态栏 | 多选时 `主题: 2 / 5`，单选时 `主题: 序号 / 总数` |

> **勘误（§31.1）**：此处原记「左右 20px / 上下 12px」，是把原版的
> **文字区 `foreignObject`** 当成了主题形状盒。当年样例 `[1303,733,84,24]`
> 是 fo，对应一级主题的 `topicG` 为 `[1285,723,120,44]`（fo 相对形状盒左右
> 内缩 18px、上下 10px），再加 2px 选中框才得到 `[1283,721,124,48]`。
> 以形状盒为基准直接实测：二级 `[1075,335,264,31]` → outline
> `[1073,333,268,35]`，中心 `[591,391,170,67]` → `[589,389,174,71]`，
> 恒定四边各 2px。实现已改为 `x-2 / y-2 / w+4 / h+4`。

原版**单选也画同一个蓝色圆角 outline**（`主题: 1 / 6` 时仍有
`topic-outline:*`），所以不能用 CSS `box-shadow` 近似；改成 stage 坐标系里的
SVG `.selection-layer`，单选 / 多选统一渲染，`pointer-events: none`。

框选后点击「概要」会新增 `foreignObject` 概要主题，并出现
`summary-body:*` / `summary-body-line:*` / `summary-outline:*` /
`summary-resize-handle-start|end:*`；状态栏变成 `主题: 1 / 6`（新概要被选中）。
Ctrl+点击可继续增量选择，出现第二个 outline。

### 22.3 概要范围必须显式传，不能靠 fallback

旧 `decor_range()` 的语义是「选中主题有子主题则覆盖全部子主题，叶子则覆盖
全部兄弟」，无法表达「只框选了连续 2~3 个兄弟」。本轮改成：

* `App.selectionRange()` 用 `LaidOutNode.parentId / side / childIndex` 分组，
  取最大的同父同侧组，按文档顺序排序，返回 `{ startId, endId }`；
* `api.addDecor()` 增加 `rangeStart` / `rangeEnd`（Tauri 2 前端 camelCase）；
* `doc_add_decor` 把它们组成 `Option<(&str,&str)>` 交给
  `ops::add_summary_with_range` / `add_boundary_with_range`；
* `ops::resolve_range()` 只在两端都是真实主题且 `parent_id_of(start) ==
  parent_id_of(end)` 时接受显式范围，否则回退旧 `decor_range()`；
* 概要主题写入 `summaryRange = { startId, endId, anchorId }`（序列化后位于
  topic 的 `__extra` 里），外框写入 `sheet.__extra.boundaries[].range`；
* layout 的 `range_bounds_from()` 按 `childIndex` 区间补齐中间兄弟，并递归
  把各兄弟的**整个子树**纳入包围盒，再画 `brace_path()` 大括号。

验证时用 `doc_export(format:'json')` 导出完整 Document（serde 的 `Json` 分支
是 `to_string_pretty(doc)`），直接断言 `__extra.summaryRange` 的首尾 id 就是
框选的两个 / 三个主题，而不是全部兄弟。

### 22.4 菜单与交互实现

* 新增 `src/shell/Menu.tsx`：`MenuItem` 模型、`sep()` / `item()`、递归
  `MenuLevel` 面板、hover / ArrowRight 展开子菜单、ArrowLeft 收起、Enter/Space
  激活、Escape 全局关闭（capture 阶段的 `MenuKeyBridge`）、视口边缘自动 flip、
  勾选态、禁用态、快捷键右对齐、危险项。
* 新增 `src/shell/menuModel.ts`：按 `target/app-menu-full.json` 与
  `target/ctx-menus.json` 逐行转录，构造 `buildMainMenu` /
  `buildCanvasMenu` / `buildTopicMenu`；`MenuContext` 决定 enabled / checked。
* `App.tsx` 成为唯一命令分发点：新增结构编辑（前后同级 / 父主题 / 自由主题 /
  标注 / 复制 / 删除单个 / 缩进 / 减少缩进 / 全折叠 / 仅显示该分支 / 重设位置 /
  从主题新建画布）、剪贴板与样式剪贴板、自由主题对齐、导入导出、格式面板联动、
  三个应用内对话框（重命名 / 信息 / 输入）、工具标签显隐、快捷键助手。
* `MapCanvas.tsx`：空白处左键拖动框选（相交即命中，非 cell 节点）、Ctrl/Shift/
  Meta 点击增量选择、中键 / Alt / **Space+拖动**平移、单选与多选统一 SVG
  outline；旧的简化 `.ctx-menu` 移除，右键只上报锚点给 shell。
* 原版 enabled 但本机确实无法实现的项（在线素材、账户服务、分支 PNG/PDF
  导出、打印分支）保持 enabled，点击后打开说明对话框或复用整图导出面板，
  不用静默无响应；原版 disabled 的项按真实上下文禁用。

### 22.5 验证

* `scripts/ui-marquee-summary.mjs`：框选矩形颜色、实时 outline、外扩 2px
  （§31.1 修正）、状态栏 `主题: N / total`、Ctrl+点击增删、两主题 / 三主题概要的真实
  `summaryRange`、括号线只覆盖选中兄弟、外框同一范围，全部通过。
* `scripts/ui-menus.mjs`：把 DOM 里的菜单行（含分隔线）与
  `app-menu-full.json` / `ctx-menus.json` 逐行 diff，覆盖 6 个主菜单子菜单、
  画布右键、中心主题右键、分支主题右键、主题「插入」子菜单 10 项 enabled、
  禁用态、勾选态、菜单动作（插入自由主题 / 复制 / 全选）、键盘导航与视口约束。
* 回归：`cargo test --workspace` 31 项、`npx tsc --noEmit`、
  `npm run build:app`、`ui-rename.mjs` 36 断言、`ui-tools.mjs` 33 断言、
  `ui-drag.mjs` / `ui-verify.mjs`、`audit-contrast.mjs`
  1376 组合 / 9632 节点低对比 0。

## 23. 概要/外框的范围手柄与分支裁剪导出（2026-11-15）

### 23.1 原版的范围手柄

选中概要（点括号线或点概要主题本身）后，原版出现 `summary-resize-handle-start`
与 `summary-resize-handle-end`：两个白心蓝边的小圆点，锚在括号线的上下两端
（纵向结构的导图里锚在左右两端，光标换成 `resize-*`）。拖动时括号线实时重画，
并给"将要吸附到的兄弟范围"画一圈虚线预览；松手后 `summaryRange` 的
`startId`/`endId` 被写回，范围永远吸附到**整颗兄弟主题**，不会停在半路。

### 23.2 实现要点

* `layout::Frame` 增加 `parentId` / `startId` / `endId` / `startX` / `startY` /
  `endX` / `endY`，手柄位置直接由布局给出，前端不再反推括号线几何。
* `ops::set_decor_range(doc, kind, id, start, end)` 是唯一的范围写入点：
  - `summary` 改主题 `extra.summaryRange`（保留原 `anchorId`）；
  - `boundary` 改 `sheet.extra.boundaries[i].range`；
  - 其余情况返回 false，IPC 层用 `Err` 回给前端并提示。
* `MapCanvas.beginRangeDrag()` 用 `pointermove` + `window` 监听（`setPointerCapture`
  在 SVG `<g>` 上不总生效），按 `childIndex` 求兄弟数组下标，start 只能往上、
  end 只能往下收，落点取"中心线距离最近的兄弟"。
* 只在拖拽过程中渲染 `.range-preview`（10% 蓝填充 + 90% 蓝虚线描边），
  松手即消失——和原版一致。

### 23.3 一个必须知道的坑：`Topic::side` 不可信

原版文件里中心主题的直属子主题**通常不写 `side`**，左右两半由布局自行均分。
所以 `same_sibling_range()` 不能比较 `Topic::side`（两者恒为 `None`，判等永远成立，
跨到另一侧的非法范围会被放行）。正确做法是 `compute_layout(doc)` 后比较
`LaidOutNode.side`；取不到节点时再退回文档里的 `side`。
`crates/xmind-core/tests/decor.rs` 里 `range_handles_stay_within_one_side_of_the_map`
专门锁这条：同一份文档里 `children.iter().all(|t| t.side.is_none())`，
但左右跨侧必须被拒绝。

### 23.4 分支裁剪导出

`ops::branch_document(doc, id)` 把选中的主题复制成新的中心主题（清 `side` /
`position` / 折叠状态，丢掉其它分支，标题记成 `原文档名-分支名`），并取该主题
所在分支的色相作为新的中心色，这样导出的图**只有这一支**，和原版"导出分支为…"
的裁剪结果一致。

* `doc_export_branch(path, format, id)`：`svg` / `md` 直接走 `xmind_file`；
* `doc_branch_svg(id)`：把裁剪后的 SVG 源码交给前端；
* PNG / PDF 在 WebView 里做：`Image` + `canvas` 栅格化（2×，最长边不超过 8000px），
  PNG 用 `canvas.toBlob`，PDF 用 `src/io/pdf.ts` 手写的单页图像 XObject
  （`CompressionStream('deflate')` 压 RGB 扫描线，`1px = 0.75pt`），
  最后 `doc_write_bytes(path, base64)` 落盘——不引入任何 PDF 依赖；
* 「打印分支…」把该 SVG 写进隐藏 iframe 再 `print()`，`afterprint` 时移除。

### 23.5 验证

* `scripts/ui-marquee-summary.mjs`：43 断言——框选/外框/计数/Ctrl+点击、
  两主题与三主题概要、外框同范围、两个手柄的位置与拖动（含虚线预览、
  括号线变长 258→388、`summaryRange` 写回）、跨侧范围被拒绝、Space 平移。
* `scripts/ui-branch-export.mjs`：15 断言——分支 SVG 只含本支、Markdown 标题、
  中心主题导出保留全部分支、`doc_write_bytes` 二进制落盘、未知 id 拒绝、
  WebView 栅格化墨迹占比、`CompressionStream` 可用。
* `scripts/test-pdf.mjs`：10 断言——PDF 头尾、Catalog/Pages/Page、图像 XObject
  色彩空间、`/MediaBox` 换算、`startxref` 与 xref 偏移、`FlateDecode` 解压后
  与原始 RGB 逐字节一致。
* `cargo test -p xmind-core`：decor.rs 6 项（含新增的范围手柄/同侧校验）。
* 回归：`ui-menus` 36、`ui-rename` 36、`ui-tools` 33、`ui-drag`、`ui-verify`、
  `audit-contrast` 1376 组合 / 9632 节点低对比 0。

### 23.6 测试脚本的两条稳定性经验

* 桌面窗口可能被缩到 660×430，框选矩形/工具栏点击会落到窗口外而"毫无反应"。
  所有 UI 脚本在连上 CDP 后先
  `Emulation.setDeviceMetricsOverride({width:1500,height:950})`，几何就稳定了。
  （`plugin:window|set_size` 被 ACL 拒绝，不要走这条路。）
* 撤销/删除/切换画布后，React 里的 `selectedIds` 可能还留着已经消失的主题，
  状态栏会显示 `主题: 3 / 5` 却只有 2 个 outline。App 里加了一个跟随
  `snapshot` 的清理 effect，同时清理失效的 `selectedDecor`。

## 24. 折叠控件改版 + 17 种骨架逐个对照（2026-11-15）

### 24.1 折叠/展开控件（`topic-unfold-button`）

原版 DOM 实测：`.topic-unfold-button` 是 **16×16 的圆**，`stroke-width: 1`、描边=分支色、
填充=画布底色；内部 `foreignObject` 12×12，文字 10px / `font-weight:300` / 分支色。
它**不是**长在主题盒边上，而是画在 `topic-connection-for-unfold-button`
（`M 50 0 L 62 0`，长 12px、`stroke-width: 2`）的**外端**——也就是"连接子主题的那条线
的起始处"。圆心里的数字是**整棵隐藏子树**的数量（`做计划` 5 子 + 9 孙 → "14"）。

实现要点：
* `descendant_count()` 统计整棵子树（含 detached/summary/callout），`hidden_count` 用它。
* 位置由 `foldAnchor(node, layout)` 给出：优先看真实子节点（有子节点时用它判断生长
  方向），折叠后没有子节点再回退到骨架；圆的圆心沿分支轴外移 12px
  ——**只沿轴**，不能同时偏移 x 和 y（早期版本那样做会让圆比主题中心低 12px）。
* 默认 `opacity: 0`，`.node:hover > .fold-badge` / `.fold-badge:hover` /
  `.fold-badge.folded` / `:focus-visible` 时才 `opacity: 1`。加 `:hover` 是因为圆有一半
  探出主题盒，指针可能落在圆上而没落在主题上。

### 24.2 骨架对照管线（可复用）

| 脚本 | 作用 |
| --- | --- |
| `scripts/make-skeleton-samples.mjs` | 用 `example.xmind` 的内容生成 15 个骨架样本 |
| `scripts/capture-xmind-skeletons.mjs` | 逐个拉起原版，抓 `topic-node` / `topic-connection` 几何 |
| `scripts/shot-xmind.mjs` | 原版截图（`target/verify/xmind-<name>.png`） |
| `scripts/compare-skeletons.mjs` | 本应用 `doc_layout` vs 抓包，输出 `skeleton-diff.json` |
| `scripts/open-sample.mjs` | **通过 UI**（主菜单→最近打开，§36 后不再经过「文件」）打开样本，React 状态才会跟着变 |
| `scripts/shot-ours.mjs` / `check-fold.mjs` | 本应用截图 / 折叠圆位置与 hover 断言 |

两个坑：
* `invoke('doc_open')` 只改 Rust 侧的文档，React 里的 snapshot 不会更新——截图必须走菜单。
* 菜单残留的 `.xm-backdrop` 会吞掉后续所有指针事件（`:hover` 也不触发），
  截图前要把它关掉，否则"鼠标移上去不显示"这类断言会假阳性。

### 24.3 实测常量（写进 `layout.rs`）

| 结构 | 实测 |
| --- | --- |
| 通用水平 | `levelX`（父右缘→子左缘）52；一级分支子树间隙 **36**；深层兄弟 7–12（取 9）；深层 pad 12/13 |
| 逻辑图 | 一级分支先展开 **160** 的扇形再放主题（其余骨架就是 52）；逻辑图/括号图都不画主体盒子 |
| 平衡图 | 左侧一半是**文档序倒排**（最后一个兄弟在最上面）；左右分配按"**累计高度不超过一半**"切分，样本上是 3 右 5 左，不是 4/4 |
| 顺时针 | 左半同样倒排；计数对半 |
| 组织结构图 | 首行距中心主题 **154**，其后每行 53；同一行兄弟几乎贴合（8–10） |
| 树形图 | 缩进从**父主题左缘**算 0.75×宽（不是右缘），深层 71；子节点距父 27，兄弟之间只有 9 |
| 时间轴（竖） | 里程碑贴在脊柱两侧 **±50**（会与中心主题的 x 范围重叠）；水平版首个里程碑在根右缘 +100，节距 = 宽 +100 |
| 树型表格 | 一列一层、**一行一个叶子**（52 叶 × 51 ≈ 2620）；父单元格居中跨在子树行上；只有竖分隔线，无连线 |
| 矩阵图 | 一行一个一级分支：标签右对齐在最左列（距二级列 32），二级主题竖排并**带下划线**，只有二级→三级才画曲线；组间 17、距中心主题 82 |
| 括号图 | 主题只留文字（一级加粗、右对齐贴着括号）；中心主题→一级 66、一级之间 36、括号内兄弟 7 |

### 24.4 结果

`skeleton-diff.json` 里逐项收敛（bbox 宽×高，原版 vs 本应用）：

```
matrix      383x2295 / 380.9x2291.5      treetable   612x2620 / 596.5x2620
tree-right  440.5x4465 / 450.1x4579      tree-left   440.5x4465 / 450.1x4579
logic-right 794x2298 / 742.5x2294.5      brace-right 680x2298 / 709.5x2206.5
org-down    4577x455 / 4732x453.3        timeline-v  667.5x2563 / 483.9x2128.2
```

仍有差距、暂未继续追的：鱼骨图的骨长（首骨 461 vs 180，形状对但节距偏短）、
横向时间轴的高度（774 vs 1013，分支上下堆叠的间距不同）、平衡/顺时针一级分支
的 y 起点（差 30–65px，XMind 自己两侧栈心也不对齐，见 §24.5）。

### 24.5 栈心是对齐"中心主题的顶边"，不是中心

实测三层数据（相对根主题左上角）：顺时针 R=1 / L=9，平衡 R=-39 / L=0，逻辑图 R=16。
根主题高 78，中心在 39——所以两侧分支栈大致以**中心主题的上边缘**为中线，
本应用原先按中心对齐，整体会低 ~39px。

### 24.6 时间轴 / 鱼骨图 / 树形图按实测重写（补追 §24.4 的三项）

§24.4 剩下的三项差距，量下来都是**规则错**而不是精度差：

**时间轴（水平）**。里程碑**底边压在脊柱上**——脊柱从中心主题的垂直中心出发，
水平连到里程碑的左下角；子树从里程碑**背离脊柱**的方向再让 27px 才起。
一级子主题按**中心距 60** 排（不是左缘 52），更深层才用 `levelX` 52；
且更深层的子主题是在父主题两侧**跨骑**（`max(h, children)`），只有一级子树是
顺序堆叠。改为按"顺序 / 跨骑"两套 span 计算后，bbox 774 → 771。

**时间轴（垂直）**。里程碑在脊柱两侧 ±50，子树**背离脊柱**生长（左侧向左、
右侧向右——此前左右都朝内，宽度少了 184）。每一层都是"父 + 27 + 子块"的纵向
级联、按中心 ±60 外移。左右各一个游标：右侧按自身子树高度 +36 前进，左侧还要
`max(自身游标, 同对右侧 y + 高度 + 35)`——这条吻合了原版全部四对里程碑
（474/554 → 1229/1309 → 1706/1827 → 2167/2288）。高度 2563.5 vs 2563。

**鱼骨图**。分支主题挂在骨**尖端**：距颅 **258.5** 到**近边**（不是远离头的那条边，
左右两向对称），4 根骨节距 400；话题从尖端往脊柱方向回退，x 每 1y 向头偏 **0.53**，
第一个话题相对分支主题**内收 34**；更深一层仍是外移 52 + 兄弟 9。
骨本身是**直线**（主题里 `shape-class: …underline` + `line-class: …bight`），
起点落在脊柱上（首骨距颅 58，其后 470），所以模型里给它 `line_class = "straight"`。
bbox 2118.5x915.3 vs 2040.6x925。

**树形图**。一级分支首个 50、其后 `v_gap` 36——此前一律用 `h_gap` 52，52 个
分支累积出 114px；改完 bbox 4465 vs 4465，1st child 完全一致。

最终对照（xmind / ours，宽×高）：

```
matrix      383x2295   / 380.9x2291.5     timeline-h  2068.5x774 / 2095.5x771.3
treetable   612x2620   / 596.5x2620       timeline-v  667.5x2563 / 593.3x2563.5
tree-*      440.5x4465 / 450.1x4465       fishbone-*  2040.6x925 / 2118.5x915.3
logic-*     794x2298   / 742.5x2294.5     org-*       4577x455   / 4732x453.3
brace-right 680x2298   / 709.5x2206.5     clockwise   1138x1174  / 1222.4x1169.9
balanced    1138x1362  / 1212.5x1359.6
```

仍存的差异（按影响排序）：

1. **没有读文档自带的 `sheet.theme`**。`example.xmind` 的 `mainTopic` 是
   `svg:fill=#00000000` + `shape-class=org.xmind.topicShape.underline`，
   原版因此把一级主题画成"纯文字 + 下划线"，我们仍按自己的默认画成
   分支色实心圆角块 + 白字。所有骨架都受影响，属"主题导入"而非布局。
2. 平衡图右侧栈心低 39px（原版 3 右/5 左时右侧栈心落在"顶边 − h/2"，顺时针
   4/4 时两侧都在顶边，没找到干净的解释）。
3. 括号图行距 19 vs 21（列宽由文字宽度决定，我们每列窄 4px）。
4. 逻辑图/时间轴竖版宽度窄 40–75px，同样是文字量宽差异。

量测/回归脚本：`compare-skeletons.mjs`（15 套骨架数 diff）、`shot-ours.mjs`（IPC
截图）、`open-sample.mjs`（走菜单打开，React 才会刷新）、`new-doc.mjs`（菜单
文件→新建，把画布清成 5 主题）、`check-fold.mjs`（折叠圆位置 + hover）。

## 25. 导出 PNG / PDF：端到端验证（2026-11-15）

验证脚本 `scripts/ui-export-raster.mjs`（需 9223 端口实例）。它**走真实代码路径**：
主题右键 →「导出分支为」→ PNG/PDF，或主菜单 →「文件 → 导出」→ PNG/PDF。
唯一被替换的是原生保存对话框——Tauri 把 `window.__TAURI_INTERNALS__.invoke`
定义成 `writable:false, configurable:false`，页面侧无法伪造，
所以 `exportBranch()` 里加了 `window.__XM_SAVE_PATH__` 钩子
（`undefined` = 真实对话框，`null` = 模拟用户取消）。

**文件级校验**（不是"文件存在"了事）：

- PNG：签名、IHDR（8bit、非隔行）、IDAT 解压、逐行反过滤（filter 0–4），
  再统计墨迹占比与颜色数；尺寸必须等于分支 SVG 声明 × 2。
- PDF：`%PDF-1.4` / `%%EOF` / `startxref` 指向 `xref`、5 个在用对象偏移逐个
  落在 `N 0 obj`、`/MediaBox` 等于 `px × 0.75pt`、图像 XObject 的
  `/Width /Height` 与 PNG 相同、`/FlateDecode` 流解压后长度 = `w*h*3`，
  且**逐字节等于 PNG 的 RGB**（同一次 canvas 的两种容器，必须完全一致）。

**发现并修掉的两个问题**：

1. **导出画布不裁剪**。`to_svg()` 直接用 `compute_layout()` 的
   `width/height`，而后者为了编辑器视口有 `.max(480.0)` / `.max(320.0)`，
   单主题分支导出成 480×320 的白底大图（内容只占左上角）。
   改为在 `to_svg` 里按节点 bbox 裁剪、四周留 26px，`viewBox` 用
   `x y w h` 形式并让背景 rect 覆盖同一范围。单主题分支 960×640 → 502×244，
   墨迹占比 8.4% → 42.2%。回归见 `svg_export_crops_to_content`（单测）。
2. **「文件 → 导出」里的 PDF 是禁用的、且没有 PNG**。XMind 原版导出菜单
   同时有 PDF 与 PNG（整张画布），这里只有右键的「导出分支为」。
   现在 `m.ex.pdf` / 新增 `m.ex.png` 都接上：导出中心主题 = 整张图
   （走同一个 `exportBranch`，只是传 root id）。

实测结果（默认 5 主题文档）：

```
分支 PNG   502x244   11.7 KB   墨迹 42.2%   ← SVG 251x122 ×2
分支 PDF   6.6 KB    MediaBox 376.50x183.00   像素与 PNG 逐字节一致
三层子树  1126x288  25.1 KB   墨迹 23.3%   PDF 844.50x216.00
整图 PNG  1150x368  43.1 KB   墨迹 31.1%   ← SVG 575x184 ×2
整图 PDF  21.5 KB   像素与 PNG 逐字节一致
取消对话框：不写文件、不弹错误提示
```

栅格化上限：`ratio = min(2, 8000 / max(w,h))`，超大画布自动降采样而不是崩掉 canvas。

## 26. 两个 XMind 官方开源「展示」项目的评估（2026-11-15）

用户先后给了两个官方仓库，问能否「改用官方的文件展示代码」。两者性质完全不同，
先分清再决定怎么用。

### 26.1 xmind-embed-viewer（1.2.0，2023，官方维护中）

`https://github.com/xmindltd/xmind-embed-viewer`。仓库只有 3 个 TS 文件约 200 行：
`IframeController` 建一个 `<iframe src="https://www.xmind.app/embed-viewer">`（国内源
`www.xmind.cn`），`IframeEventChannelController` 用 `MessageChannel` 把 `.xmind` 的
`ArrayBuffer` 经 `postMessage(['open-file', file])` 送进跨域 iframe，
`XMindEmbedViewer` 只暴露 `load / setZoomScale / setFitMap / switchSheet` 与
4 个事件（`map-ready / zoom-change / sheet-switch / sheets-load`）。

**没有任何本地渲染源码**，真正的渲染在云端页面里。实测两个域名均 301 → 200 可用。
代价：必须联网、本地文件内容交给跨域 iframe、只能只读查看、应用内编辑功能全部用不上。
显示效果 = 当前 XMind 版本，天然 100% 准确，但它是「托管服务」不是「代码」。

### 26.2 xmind-viewer / SnowbrushRenderer（1.1.2，2020，官方已废弃）

`xmind-viewer-master`（fork 自 XMind Ltd. 官方仓库），README 第一行就是
**DEPRECATED - Never ever use it in a production environment!**。但它才是真正的
**本地渲染源码**：`loadFromXMind(zip)` 读 `content.json`（新版）或 `content.xml`（老版），
`SnowbrushRenderer(sheets).render()` 用 `@svgdotjs/svg.js` 输出完整 SVG。包含：

- 17 个骨架类（`src/structure/*.ts`）：map/unbalanced/clockwise、logic 左右、
  org-chart 上下、tree 左右、timeline 横竖及上下、fishbone 左右头 + 4 个 normal；
- 19 种主题形状（`src/view/renderEngine/topicShape/*.ts`）：underline / doubleUnderline /
  roundedRect / ellipse / fishboneUnderline / stack …；
- 完整的**主题样式系统**：`model/theme.ts` + `utils/styleManager/`（LayeredStyleManager、
  sheet/topic/mindMap 三级 selector）+ `common/constants/styles.ts` 的 `StyleKey`
  （`svg:fill`、`shape-class`、`fo:color`、`border-line-*`、`line-class`、
  `spacing-major/minor`、`multi-line-colors`…）+ `defaultStyles.ts` 的各级默认样式；
- 连线、文字、bounds、字体度量等一整套工具。

本仓库已被现代化改造（Node 22 / TS 7 / esbuild dev server / preview 脚本），
`npm install → npm run build → npm run preview` 可复现，浏览器端也有 shim 过的
`dev-dist/app.js`。

### 26.3 实测：拿 16 个样本喂给官方渲染器

`scripts/render-official.mjs`（需 `../xmind-viewer-master` 已 build，可用
`XMIND_VIEWER_DIR` 覆盖）渲染 `example.xmind` + 15 套骨架样本，产出
`target/verify/official/{*.svg,report.json,compare.html}`。`compare.html` 是三列对照：
官方 SVG / XMind 桌面版原版截图 / 本应用截图。

```
成功 12 / 失败 4
  brace-right    FAIL  getChildStructure  (org.xmind.ui.brace.right 不支持)
  matrix         FAIL  getChildStructure  (org.xmind.ui.spreadsheet 不支持)
  treetable      FAIL  getChildStructure  (org.xmind.ui.treetable 不支持)
  timeline-h     FAIL  parent is not defined

example/clockwise  1314x1197    balanced 1162x1374
logic-*             943x2358    org-*    7003x486
fishbone-*       3172x1200 / 3324x1188
timeline-v       5007x4412      tree-*  396527x7885  ← 爆掉，页面全白
```

**好的一面**：每个成功样本都读到了 `sheet.theme`（`hasTheme=true`），SVG 里有 16 个
`fill="#00000000"`，一级/二级主题渲染成**纯文字 + 下划线**、连接线按 multi-line-colors
着色——这正是 §24.6 记的「最大剩余差异：主题未导入」的对岸。三方对照页里，
官方列与本应用列最刺眼的区别就是「纯文字 vs 实心分支色块」
（**已在 §26.5 实施方案 A 后消除**）。

**不能当主画布的原因**：

1. 它是 2020 年的渲染器，和当前 XMind 桌面版几何已不同：tree 的 bbox 爆到
   396527px（截图一片空白）、timeline-v 5007×4412（原版 667×2563）、
   org-down 7003×486（原版 4577×455）、fishbone 3324×1188（原版 2040×925）。
   紧凑型骨架（clockwise / balanced / logic）反而接近原版。
2. 线条风格是老版 elbow 直角，原版现在是曲线；对照页 logic-right 三列可直接看出。
3. 4/16 骨架（括号图、矩阵图、树型表格、横向时间轴）直接抛错，这些恰是
   §24 刚校准过的骨架。
4. 只读 SVG，没有编辑/撤销/就地改名/装饰/选中/导出，接进来等于把编辑器降级成查看器。
5. 上游明确 DEPRECATED，且依赖 jsdom / svgdom / node-canvas（浏览器要靠 shim 才能跑）。

### 26.4 结论：有用，但该用的是「样式与布局规范」，不是整个渲染器

按价值排序的三种用法：

| 用法 | 价值 | 风险 |
|---|---|---|
| **A. 移植主题/样式系统**（推荐） | 把 `StyleKey` + `Theme` + `LayeredStyleManager` 的解析规则搬进 Rust `EffectiveStyle`，读 `sheet.theme.centralTopic/mainTopic/subTopic` 的 `svg:fill` / `shape-class` / `fo:color` / `border-line-*` / `line-class`。**一次性解决全部骨架的「实心色块 vs 纯文字下划线」差异**，纯增量、不丢任何编辑能力 | 需跨 xmind-file（解析保留 theme）→ xmind-core（样式基准）两个 crate；配色方案面板要同步 |
| **B. 本地「官方对照视图」** | 打成浏览器 bundle 接进 WebView，离线只读并排看，作为后续回归基准 | 4 种骨架打不开、长图会爆，只能当参考 |
| **C. 主画布整体替换** | 无需再调布局 | 丢编辑、几何与当前 XMind 不符、上游废弃，不推荐 |

另外 `defaultStyles.ts` / `layoutSettings.ts` 里的常量（`spacing-major 50pt`、
`spacing-minor 35pt`、`COLLAPSE_GAP 13`、`LINE_CONTROL_OFFSET 13`、`BOUNDARY_GAP 10`、
`PADDING 20`）可作为 §24 那批「靠截图实测猜出来的常量」的规范交叉验证来源。

### 26.5 方案 A 已实施：`sheet.theme` → `EffectiveStyle`（2026-11-15）

**新增** `crates/xmind-core/src/theme_style.rs`：照官方 `common/constants/styles.ts`
的 `StyleKey` 原样保存 `sheet.theme` 的 `map / centralTopic / mainTopic / subTopic`
四层 `properties`，并抄入 `defaultStyles.ts` 的三层默认样式。附带 `color()`
（`#00000000` → `none`）、`shape()`（`org.xmind.topicShape.underline` → `underline`）、
`pt()`、`font_weight()` 等转换。`xmind-file` 一行没改：`xmind.rs` 早就把整个
`theme` 留在 `Sheet.extra`，天然保真。

**接入方式**：`ThemePalette` 多一个 `sheet_theme: Option<SheetTheme>`，于是所有已
经接收 `&pal` 的 `place_*` / `make_node` 无需改签名。`compute_layout` 从
**当前活动 sheet** 的 extra 解析主题，并把 `map` 的 `svg:fill` → 画布背景、
`multi-line-colors` → 分支色环、`line-tapered` → 锥形开关。`Metrics.font` 由主题
字号驱动，`node_size()` 与 `EffectiveStyle.font_size` 用同一套数字。

**层叠顺序**（`style_for`）：内置默认 → `apply_theme_layer` → 用户 `topic.style` →
下划线/手绘修正。主题给了 `fo:color` 就视为显式墨色，`ensure_contrast` 不翻转。
`resolve()` = theme → `defaultStyles`：`subTopic` 常不写 `shape-class`，正是这条
回退让真实 XMind 的二级主题变成「纯文字 + 下划线」。`line-class` / `line-color` /
`border-line-*` 只取 theme 显式值，不回退 2020 默认值（否则会把已校准的曲线
换成 elbow、把彩虹分支换成 #333333）。

**两个关键取舍**：

1. `colorThemeId` 以 `XMindRS-` 开头的主题 `has_theme=false`，完全不参与渲染。
   `doc_new` 会往 sheet 里塞 `theme_for()`，那是给真实 XMind 看的**写回产物**；
   它带 `line-tapered: none` 和 `roundedElbow`，若照读会让新建导图连线退化。
   配色方案仍由 `Document.branch_colors` / `center_color` 驱动（既有行为不变）。
2. 下划线形状由 CSS `.node-title` 的 `border-bottom` 画（贴合文字），
   `shape::outline("underline")` 那条线必须 `stroke="none"`，否则出现第二条
   拉满主题盒的线。新增 `underlineColor` / `underlineWidth`：颜色按官方
   `BORDER_LINE_COLOR → LINE_COLOR` 回退到分支色，粗细取 `border-line-width`；
   前端 `--ul` / `--ulw` 消费，SVG/PNG/PDF 导出用同一组值。

另外 `theme_for()` 的字号字重改成与渲染默认一致（30/18/14pt、500/500/400），
`build_edges` 的 `bight` 在锥形分支下仍走 §24 实测的 Q 脊椎。

**验证**（全部通过）：

- `cargo test --workspace`：新增 `theme.rs` 5 项 + theme_style 单测 3 项 +
  roundtrip 的 `underline_shapes_export_their_theme_colour`；既有 35 项全绿。
- `npx tsc --noEmit`、`npm run build:app`。
- `scripts/ui-theme-style.mjs`（新增，22 断言）：`example.xmind` 72 节点，
  根白底黑字、8 个一级主题 `fill=none` + underline + `#091C34`、20 个二级
  主题继承 default underline、`#F7F7FA` 画布、DOM 下划线 2px / rgb(240,65,55)、
  SVG 形状层不画第二条线；报告 `target/verify/theme-style-report.json`。
- `ui-export-raster.mjs` 33 项（PNG/PDF 像素仍逐字节一致）、`ui-rename.mjs`
  36 项、`check-fold.mjs`、`ui-verify.mjs`、`compare-skeletons.mjs`：
  16 套骨架 bbox 与 §24 记录一致（timeline-h 2095.5×771.3、tree 450.1×4465…）。
- 新建文档回归：`hasTheme=false`、一级仍是分支色实心块、4 条连线仍为
  tapered curve。截图 `target/verify/theme-example.png` 与原版
  `xmind-logic-right.png` 对照，中心白底黑字 + 彩虹下划线一致。

**残余差异**（都不属于本次范围）：本机没有 Montserrat，回退到系统 sans-serif；
导出的下划线仍是主题盒宽（CSS 版贴合文字）；`line-width` 的 pt→px 换算未做，
主题写 2 就按 2px 画；`defaultStyles` 的 spacing 常量尚未用来复核 §24 的间距实测值。

## §27 骨架切换的线条层叠（2026-11-16）

**问题**：切换骨架时，第二级及以下的线条样式不发生变化。

**事实来源**（都是原版桌面版 bundle / 官方 viewer 源码，不是推测）：
- `target/8846.js` 里 43 个骨架预设的 `theme` 是**三层**：
  `centralTopic` / `mainTopic` / **`subTopic`**，每层都有独立的
  `line-class`、`line-width`、`line-pattern`、`shape-class`、`fill-pattern`。
  `subLine` 分布：roundedElbow 19、elbow 9、bight 7、fold 2、curve 3、
  straight 2、roundedfold 1；`subShape` 有 roundedRect/underline/rect 三种。
  `theme.map.properties['line-tapered']` 有 none(36) / normal(4) / tapered(3)。
- 官方 `xmind-viewer` 的 `AbstractStructure.getAttachedConnectionInfo` 用
  `startBranch.connectionViewController.lineShape`（**父主题**层的
  `LINE_CLASS`）；`topicLineStyle.ts` 的 `lineWidth` 也取 parent，
  `lineColor` 取 `endBranch`（子主题）的 `view.lineColor`。
  即：**连线形状/宽度 = 父层，颜色 = 子层**。
- `BranchConnection` 共 8 种：curve / bight / roundedElbow / elbow / straight /
  fold / roundedfold / horizontal；`brushes.ts` 给出 fold（2/3 处斜折）、
  roundedfold（1/2 处圆角膝）、elbow（直角）、roundedElbow（圆角）等几何。

**旧实现的四个错误**：
1. `extract-skeleton-presets.mjs` 只抓了 central/main 两层，丢掉 subTopic。
2. `doc_apply_skeleton` 只把样式写进 root 和一级主题，二级及以下没有样式可继承。
3. `build_edges` 把 `line-class` / `line-width` / `line-tapered` 全部取自**子节点**，
   与官方父层规则相反；中心主题层（`centralLine`）因此完全没用上。
4. `line_tapered` 内置默认 true 且 wedge 分支覆盖了所有线型，切换后仍是一片
   锥形楔子；elbow 与 roundedElbow 共用带圆角的路径；任意 `line-pattern` 被
   直接塞进 `stroke-dasharray`（WebView 会丢弃非法值，虚线看起来是实线）。

**修复**：
- 重新提取三层数据 → `research/skeleton-presets.json`（追加 subLine/subShape/
  subPattern/subWidth/subFill/mainWidth/centralWidth/tapered）、
  `research/skeleton-themes.json`（43 份完整 theme 备份）、`src/inspector/skeletons.ts`。
- `ops::apply_skeleton_styles(doc, central, main, sub, tapered)`：把三层样式写进
  root / 一级 / **所有二级以下 attached 主题**（detached/summary/callout 保留各自的
  theme layer）；每个受控字段都显式写值，避免从手绘预设切走时残留旧 pattern。
  `doc_apply_skeleton` 新增 8 个 camelCase 参数。
- `build_edges` 改按父主题取几何与线宽、按子主题取颜色与箭头；补
  `fold` / `roundedfold`（`fold_geometry` 按 `brushes.ts` 的 2/3 与 1/2）、
  `horizontal`；elbow 与 roundedElbow 分开（直角 / 圆角，垂直骨架也有圆角）；
  `tapered` 只让 `curve` 走实测 Q 脊椎，其它线型沿自己的采样点生成楔子；
  `dash` 规范化为 dash/dot/dash-dot；`style_for` 的 mainTopic 默认线宽 3→2
  （原版 3pt/2pt/2pt）。
- `export.rs`：tapered 楔子导出为 `fill` 而不是空描边轮廓，虚线导出
  `stroke-dasharray`，与画布/PNG/PDF 一致。

**验证**：`cargo test --workspace` 43 项全绿（新增 4 项连线/级联测试 +
1 项导出一致性测试）；`npx tsc --noEmit`；`npm run build:app`；
`scripts/ui-skeleton-lines.mjs` 17/17（真实 UI 点骨架卡片，逐层断言
root→1 / 1→2 / 2→3 的 path、tapered、style.lineClass，以及连续切换不残留）；
`ui-theme-style` 22/22、`ui-export-raster` 33 项 ALL PASS、`ui-rename` 36 项、
`check-fold`、`ui-verify`、`ui-skeleton-board`、`compare-skeletons`
（16 套 bbox 与 §24 一致）。截图：`target/verify/skeleton-lines-{before,after,
elbow,fold,final}.png`。

### 「能否完全复刻原版线条样式」——结论：不能 100%，但几何已接近

已复刻：8 种 line-class 的路径、三层 theme 级联、`line-tapered` 三态、
line-pattern（虚线/点线）、父层线宽 / 子层线色、切换不残留、SVG/PNG/PDF 一致。

仍做不到（按影响排序）：
1. **手绘笔刷**：43 个预设里 12 个是 `handdrawn-*`（NeverMind Hand 字体 +
   `hachure/crossing/zigzag` 填充 + 带随机抖动的笔触路径）。我们只有等宽描边和
   简单纹理，原版笔触的抖动、起收笔、压感变化没有开放数据可复现。
2. **control 点**：官方由 `startBranch.topicShape.getControlPosition()` 按父主题
   形状动态算，我们用 gap 的 1/2 固定近似；因此 fold/roundedfold/elbow/straight
   的折点位置仍有偏差（官方 straight 其实是 `L control L end` 两段，我们是一条直线）。
3. **特殊骨架的独立线条**：时间轴脊柱、鱼骨骨刺、树形图分支、括号图括号、
   矩阵/树型表格网格，都在 `layout.rs` 里单独绘制，不走 line-class，切换骨架时
   不会随预设变化。
4. **锥形楔子**：原版有 mask（中心主题下裁掉连线）和精确宽度渐变，我们是
   24 点采样的多边形近似。
5. **箭头**：只实现了少数几种 SVG marker，`arrow-end-class` 的多种形状/填充未覆盖。
6. **线色渐变 / 透明度**：`multi-line-colors` 只按分支取色，未处理渐变与
   `svg:opacity` 对连线的作用。
7. **样式优先级**：原版 `LayeredStyleManager` 里用户 `topic.style` 优先于 theme，
   我们把预设写进 `topic.style`，会覆盖用户手工设置的线型（已存在的取舍）。
8. **字体度量**：缺 Montserrat / NeverMind 时端点、下划线宽度与官方不同；
   `line-width` 的 pt→px 换算也还没做。

结论：要做到像素级完全一致，需要原版当前桌面版的连线渲染源码（闭源
webpack bundle 中未剥离的部分）与字体资源；现阶段可做到「线型、层级、
颜色、粗细、锥形三态、导出」一致，几何细节与手绘笔刷属于已知残余差异。

---

## §28 官方 GitHub 组织 `xmindltd` 资源盘点（2026-11-16）

针对 §27 结论里「缺原版连线渲染源码与字体资源」做的公开资源核查。
组织下共 **14 个公开仓库**，逐一看过根目录与 README；代码搜索
`org:xmindltd` 只命中规范/主题/SDK，没有任何当前桌面版渲染器。
落地清单见 `research/official/manifest.json`（含来源 URL 与许可）。

### 28.1 字体资源：已找到，可合法内置（修正 §27 第 8 条）

- **`xmindltd/nevermind`**（193★，SIL **OFL 1.1**，34 MB）：XMind 自研品牌
  字体全家族。`fonts/NeverMind/` 有 20 个 TTF（10 字重 × 正/斜），
  `fonts/NeverMindFamily/` 另有 14 个子家族，含 `NeverMindHand/ttf/`、
  `WidthVariable/NeverMind Condensed/` 等。实测 sfnt 头合法、family 名正确，
  **不含 CJK 字形**（U+4E00 不在 cmap）——中文按官方字体栈回退系统字体即可。
- 与桌面版对照：本机 `%LOCALAPPDATA%/Programs/Xmind/resources/app.asar`
  里内嵌 `NeverMind-Bold.ttf` / `NeverMind-Condensed*.ttf` /
  `NeverMindHand-*.ttf`，**文件名与开源仓库一一对应**，所以这个仓库就是
  桌面版所用字体的可分发来源，不是旧版替代品。
- 原版 bundle（`target/8846.js`）的字体栈是
  `'Montserrat','NeverMind','Microsoft YaHei','PingFang SC','Microsoft JhengHei','sans-serif',sans-serif`，
  且大量骨架预设直接写 `fo:font-family:"NeverMind"`；`NeverMind` 在 bundle
  中出现 3598 次、`Montserrat` 812 次。
  `example.xmind` 的主题三层都写 `Montserrat`（28/18/14pt，700/600/400）。
- **Montserrat / Open Sans 不在 xmindltd 组织里**，但都是 Google Fonts 的
  OFL 1.1 可变字体，可直接下载（已验证 `fvar` 表存在，Chromium/WebView2
  支持）。`Avenir Next` 是 macOS 商业字体，不可分发，只能回退。
- 样本已下载到 `target/verify/fonts/`（NeverMind Regular/Medium/Bold、
  NeverMindHand-Regular、Montserrat[wght]、OpenSans[wdth,wght]）并附两份
  OFL 文本。OFL 允许随应用打包，但必须随附版权/许可文本、不得单独售卖、
  改版不得沿用保留名称。

### 28.2 当前桌面版连线渲染源码：仍然没有

- `xmindltd/xmind-viewer`（78★，**archived**、README 首行
  `DEPRECATED - Never ever use it in a production environment!`，只有 master
  分支，最后推送 2021-05）就是本地已有的 `xmind-viewer-master` /
  SnowbrushRenderer，**不是当前桌面版**。
- `xmind-embed-viewer` 只是云端 iframe + MessageChannel 桥接，无渲染源码；
  `xmind-sdk-js` / `xmind-model` / `xmind-generator` / `xmindmark` /
  `xmind-sdk-python` / `xmind-sdk-swift` 都是文件读写 SDK；`xmind-cli` /
  `assay` / `mapify-*` / `hiring` 与本问题无关。
- 本机 `app.asar` 里能看到 `changeBranchLineStyle`、`brush`、
  `catAxisLineStyle` 等符号和完整类名，但只有压缩后的 webpack bundle
  （逻辑在、源码不可读），几何仍只能逆向常量，不能「拿来就用」。

### 28.3 可立即用的规范资源（能补掉 §27 的部分差距）

- **`xmind-model/src/common/constants/styles.ts`**（MIT，已下载）：比本地
  2020 viewer 的 `styles.ts` 更全——`STYLE_KEYS`（`cjk-font-family`、
  `color-gradient`、`fill-gradient`、`border-gradient`、`fo:margin-*`）、
  `STYLE_LAYER` / `STYLE_PARENT_GROUP`（`beforeUser/beforeClass/beforeTheme/
  beforeDefault/beforeParent` 五层优先级）、`BRANCHCONNECTION` 全集、
  `ARROWSHAPE` 18 种、`ARROWLINEPATTERN`（`dash-dot-dot`、`round-dot`，
  我们没实现）、`RELATIONSHIPSHAPE`、`SUMMARYCONNECTION` 8 种、
  `COMMON_FONT_FAMILY`。
- **`xmind-sdk-js/src/common/themes/{snowbrush,robust,business}.json`**
  （MIT，已下载；`xmind-sdk-swift/Sources/XMind/Theme.swift` 内嵌同一份
  snowbrush）：官方完整主题，含 `map.line-tapered: "tapered"` 的规范取值、
  **`level3` 第四层样式**（我们只做了 central/main/sub 三层）、
  `line-width` 明确的 `pt` 单位（可据此做 1pt = 4/3 px 换算）、
  `arrow-begin-class` / `arrow-end-class`、relationship/boundary 样式。
- **`xmind-cli` 的 Skill**：`xmind skill show visual/layout-style
  visual/node-style` 能拉到官方视觉规范（需登录，未验证），可作为后续
  骨架/线型常量的交叉验证渠道。
- `app.asar` 里的 `branchConnection.*` 全集（仅字符串常量）：
  `brace, brace2..brace5, fish, fishbone, matrix, sidedTimeline, timeline,
  treeTableNoConnections, arrowedCurve` 等，说明 §27 第 3 条「特殊骨架独立
  线条」在原版其实也走 line-class，只是我们没实现这些类。

### 28.4 结论修正

**字体这一项不再缺失**：Montserrat + NeverMind（含 Hand/Condensed）可按
官方字体栈内置，中文回退 Microsoft YaHei / PingFang SC，能去掉 §27 第 8 条
的字体度量差异。**渲染源码这一项仍缺失**，但规范类资源足以继续缩小
§27 的第 2/5/6/8 条（control 点近似、箭头形状、pt 换算、level3 层）；
第 1 条手绘笔刷与第 4 条锥形 mask 依然没有开放数据。

---

## 29. `example2.xmind` 两版实图对照（2026-11-16）

原版 XMind 23.07（CDP 9222，启动须清 `ELECTRON_RUN_AS_NODE`/`NODE_OPTIONS`，
打开文件后 Ctrl+0 切「实际大小」100%）与 xmind-rs 隔离实例（CDP 9223，
`XMIND_RS_DATA_DIR` + `WEBVIEW2_USER_DATA_FOLDER` + 9223，视口 1500×950）
分别打开同一个 `example2.xmind`。截图：`target/verify/xmind-example2-final.png`、
`target/verify/ours-example2{,-final}.png`（调整前后），并排对照页
`target/verify/compare-example2.html`。该文件用外来主题
`Energy-#FFFFFF-MULTI_LINE_COLORS` + `org.xmind.ui.logic.right`，含 3 个原生概要、
1 条联系线、1 个浮动子树，正好覆盖 §26/§27 没测过的分支。

### 29.1 原版实测色值（DOM/SVG 直读，100% 缩放）

| 元素 | 填充 | 墨色 |
| --- | --- | --- |
| 中心主题 深圳宏峰 | `#0D0D0D` | `#FFFFFF`（28pt/600 NeverMind，蓝描边是选中态） |
| 一级 暗物广州 | `#F22816` | `#FFFFFF`（18pt/600） |
| 二级 5 个 | `rgba(242,40,22,.2)` → 白底 `#FCD4D0` | `rgb(96,12,5)` ≈ `#600C05` |
| 二级中 2 个自定 | `rgba(142,222,153,.2)` → `#E8F8EA` | 同上 |
| 浮动主题 | `#F2B807`（用户 style） | `#0D0D0D` |
| 浮动子主题 3 个 | `rgba(13,13,13,.2)` → `#CECECE` | `#333333` |
| 概要 2 个 | `#025A5A` / `#4A148C` | `#FFFFFF` |
| 概要「授权+定制开发」 | 无填充 | `#0D0D0D` |

- 三色概要/白底概要都有 `#233ED9` 2px 描边；每个主题还有第二条 outline path，
  `stroke-width=0` 时不画，只有 summaryTopic 的 `sw=2` 画蓝边。
- 分支连线 `#F22816` 2px `roundedElbow`；联系线 `#0D0D0D` 2px、dash `9 3`，
  三次贝塞尔端点 = 节点中心 + `lineEndPoints`，控制点 = 端点 + `controlPoints`。
- 概要括号：curly `M 10 1 C 46 1, 0 h/2, 36 h/2 C 0 h/2, 46 h-1, 10 h-1`；
  square `M 10 1 L 23 1 L 23 h-1 L 10 h-1 M 23 h/2 L 36 h/2`；
  `summaries[].range` 是字面兄弟索引（`(0,0)` 一行、`(3,4)` 两行、`(0,2)` 三行）。

### 29.2 调整前四个根因

1. 主题层 `"inherited"` 被当成颜色字符串写进 SVG/CSS → SVG 回退黑填充、文字回退黑，
   于是全图黑底黑字。`resolve()` 还会把它交给 2020 `defaultStyles`。
2. `theme::read_palette` 优先取 `color-list`（6 个含白/灰/黑的中性色板）覆盖
   `multi-line-colors`（红/黄/蓝三色），连线被画成 `#FFFFFF`，白底上不可见。
3. 逻辑图 `node_x` 在 depth≥2 重新用 `h_gap` 起算，丢掉 `root_gap=160`，
   二级主题比父主题右边缘还靠左 → 父子互相重叠。
4. 只认自研 `topic.extra.summaryRange`；原生 `children.summary` +
   `summaries[]` 没布局，14 个主题只画 11 个，括号/概要主题全缺。

### 29.3 改动

- `theme_style.rs`：新增 `is_inherited`，`resolve()` 遇 inherited 不落 2020 默认；
  `color()` 把 `#RRGGBBAA` 与不透明白画布一次合成实色（对比度助手可继续工作）。
- `layout.rs`：`apply_theme_layer(..., branch)` 按实测派生一级实心分支色 + 白字、
  二级 20% 洗色 + 40% 暗墨；用户 style 的 fill/color/line-color 统一归一化，
  一级改填充时重挑墨色；`native_summary_style` 读 `summaryTopic` 层；
  `place_native_summaries` 按 `range` 摆概要主题并画 curly/square 括号；
  联系线读 `theme.relationship`，用 `lineEndPoints`/`controlPoints` 走 C 曲线；
  浮动子树改中性灰 20% + `#333` 文字。
- `theme.rs::read_palette` 优先 `multi-line-colors`；`node_x` 所有层共用
  `root_gap`；前端 `Link` 增 `width`/`dash`/`arrow`（`types.ts` + `MapCanvas.tsx`）。

### 29.4 残余差距（仍不能声称像素级一致）

两版画布平移/滚动量不同（原版 100% 时右侧概要被视口裁掉）；长中文子主题
折行盒宽比原版宽（自研 clamp 340 vs 原版 ≈286 未缩放）；字体度量、notes 图标、
中心主题选中描边等细节未对齐。

### 29.5 回归

`cargo test --workspace`（43 项）、`npx tsc --noEmit`、`npm run build:app`、
`ui-theme-style` 22/22、`ui-skeleton-lines` 17/17、`ui-verify`、
`compare-skeletons`（16 套 bbox）通过。**坑**：UI 回归依赖右侧格式面板打开；
若为截图关掉面板，脚本找不到 `.fp-tabs` / 骨架触发按钮，会误报 9/17 与一堆
`missing`，先点回「格式」再跑即可。

### 29.6 「插入概要」写入格式（2026-11-16 实测修复）

用户复现：框选/Ctrl 选中 2 个主题 → 工具栏「概要」→ 新概要样式与文件里
其它概要不同（黄底 `#F2B807` 实心、无蓝框），保存后用原版 XMind 打开看不到它。

**权威格式**（example2.xmind 原版 DOM + content.json 双向确认）：概要主题必须
放在**覆盖范围的父主题**的 `children.summary` 里，同时该父主题要有
`summaries[]` 项 `{id, range:"(a,b)", topicId, style:{properties:{"shape-class":
"org.xmind.summaryShape.curly"}}}`；`range` 是 `children.attached` 的**字面
索引**，不是 topic id。原版完全忽略 `topic.extra.summaryRange` 这类私有键。

**旧实现的两个错误**：`ops::add_summary_with_range` 只写
`topic.extra.summaryRange = {startId,endId,anchorId}`，且把主题 push 到
`doc.root_mut().summary`（中心主题下，而非范围父主题下）；因此
(a) 新主题走 `collect_summaries` + 浮动子树分支，拿到普通/分支色样式而不是
`native_summary_style`（`summaryTopic` 层：无填充 + `#233ED9` 2px 描边），
(b) 保存的 content.json 没有 `summaries[]`，原版找不到概要注册，括号和主题都不画。

**修复**：
- `ops.rs`：`add_summary_with_range` 用 `parent_id_of(start)` 定位父主题，
  `sibling_indices()` 把两个 id 换成 `(a,b)`，写原生 `summaries[]` 并把主题
  push 到该父的 `summary`；不再写私有扩展。
  `set_decor_range("summary")` 改原生表的字面索引（旧格式仍走兼容分支）；
  `remove_decor("summary")` 通过 `remove_summary_refs()` 同时删主题与注册，
  避免留下空括号；`rename_decor` 不变（原生也认主题 title）。
- `ops::migrate_legacy_summaries()`：读取时把旧私有格式**自动升级**——按
  start/end 找到真正的父、把主题搬过去、删 `summaryRange`、补原生注册；
  在 `xmind-file::from_content_json` 末尾调用，无旧键的文件不受影响（幂等）。
  用户此前保存的 `example2.xmind` 里恰好有这样一个旧概要，重开即自动修好。
- `layout.rs`：`collect_native_summary_ids()` 收集已被原生表认领的概要 id，
  浮动子树循环与 `build_decorations` 的 `collect_summaries` 都跳过它们，
  避免同一个概要被画两次（一条原生 + 一条自研括号）。
- `scripts/ui-marquee-summary.mjs` 断言从「概要主题写入 summaryRange」改为
  「父主题写入原生 summaries[] + 字面 range」，并新增
  `crates/xmind-core/tests/decor.rs` 两个回归（原生写入、旧格式迁移）。

**验证（真机）**：隔离实例打开含旧概要的 example2.xmind → 旧概要从黄底变成
`fill=none / stroke=#233ED9 / 2px`，与「授权+定制开发」一致；Ctrl 选 2 个主题
再插入概要 → 新节点 1 个、新括号 1 个；保存的 `summary-fixed.xmind` 有
**5 个 `summaries[]` 注册 + 5 个 `children.summary` 主题 + 0 个 `summaryRange`**；
原版 XMind 23.07（9222，Ctrl+0 100%）打开该文件，DOM 里 5 个概要主题全部
可见（含 2 个标题「概要」），curly/square 括号都在。
`ui-marquee-summary` ALL PASS、其余回归见 §29.5。

**注意**：同一组兄弟上叠多个概要时，两版都会把它们画在相近位置而文字重叠
（原版截图同样如此），属于范围重叠的布局限制，不是格式问题；Ctrl+点击多选若
`selectionRange()` 未命中同父同侧分组，会回退到 `decor_range()` 覆盖全部兄弟，
框选路径实测正常（`(0,1)` / `(0,2)`）。

### §29.7 标题栏拖动 / 编辑状态 / 概要样式面板（2026-11-16）

**原版实测**（9222，选中一个概要后的 `editor.html`）：
- 整条 `.uk-window-expanded-title-bar.app-region-enabled` 是拖动区；
  文件名区 `.top-bar-title-bar-container` 两行：title 15px/600/20px + subtitle
  11px/`#86898C`/14px（文本为「已编辑」，未编辑时为空，保存时为「保存中...」）。
- 选中概要时 `.uk-format-panel` 只显示 **概要线型 / 概要主题 / 边框 / 文本 / 分支**
  五组 + 更新、重设样式；没有「形状」「结构」「画布」组。概要线型 = 括号形状按钮
  （`summary-curly.svg`）、线型、颜色、线宽「细」；概要主题 = 形状、填充「无」、
  宽度 PX、适合。

**实现**：
- 拖动：整个 `<header class="titlebar" data-tauri-drag-region="deep">`。Tauri
  **2.12.5** 的 `window/scripts/drag.js` 支持 `deep`（沿 composedPath 向上找属性），
  且 `BUTTON/A/INPUT/SELECT/TEXTAREA/LABEL/SUMMARY` 等 clickable 元素在无属性时
  直接 `return false` —— 正好满足「整条工具栏可拖，按钮等控件排除」，无需给每个
  子元素加 bare 属性（bare 只认 `el === composedPath[0]`，反而会漏掉子元素）。
- 状态：`App.saving` + `savingRef` 防重入，`saveFile` 用 `try/finally`；
  `.doc-status` 三态（空 / 已编辑 / 保存中...）且恒占 14px 避免跳动；
  `MenuContext.saving`，`m.save` 的 `disabled = !dirty || saving`；后端 `doc_save`
  本来就 `dirty.store(false)`，所以保存完成菜单自动置灰。
- 概要面板：`summaryActive` = `selectedDecor.kind === 'summary'` 或 `selected` 命中
  summary frame（frame.id 就是概要主题 id）；点工具栏「概要」插入成功后自动
  `setSelectedDecor` + 打开格式面板「样式」页。`Inspector` 在两组里复用现有
  popover，`styleTargetId` 在概要模式优先指向概要主题；概要模式隐藏「形状 / 结构」。
- 选项真正落盘：新增 `ops::set_summary_style` / `doc_set_summary_style` /
  `Frame.width`，写入原生 `summaries[].style.properties` 的
  `shape-class`（curly/square）、`line-color`、`line-width`；
  `place_native_summaries` 优先读 entry.style，再回落 `theme.summary.line-color`，
  pt 按 4/3 换算 px。保存后原版 XMind 也能识别这些键。

**真机验证（9223）**：复现 drag.js 判定，工具栏空白 / tool-group / tool-item /
文件名 / 窗口按钮区空白 `true`，「概要」按钮及其内部 svg `false`；
MutationObserver 记录 `["已编辑","保存中...",""]`，保存菜单 `disabled` false→true；
选中概要后面板含两组，点「方括号」括号 path 由 C 曲线变 `M…L…`，点「粗」
stroke-width 8.17px（5pt×4/3 + 选中态 1.5）；点工具栏「概要」后 frames 5→6
且面板仍在「样式」。`cargo test --workspace`（18 组 ok）、`npx tsc --noEmit`、
`npm run build:app`、`ui-theme-style` 22/22、`ui-skeleton-lines` 17/17、
`ui-verify`、`compare-skeletons`、`ui-marquee-summary` ALL PASS。

## 30. 主题内边距与按层级等宽（2026-11-16，原版 DOM 实测）

用户反馈：`example2.xmind` 里主题/子主题文字太靠左、左边距不够，右边距还好；
原版会把同一层级（同一主题下）的子主题宽度调成一致，看起来更整齐。

### 30.1 原版实测（9222，`foreignObject` / `topicG` / shape path 直读）

* 文字区不是贴形状左边框，而是 **左右对称内缩**：中心 `topicG 170` / `fo 112`
  → 29/29 px；一级 18/18 px；二级及以下 6/6 px（`topicG 264` / `fo 252`）。
  即 `h_pad(depth) = 58/36/12`（= 2×29/18/6）恰好是形状盒比文字区多出的宽度。
* `example2.xmind` 的 `sheet.theme.centralTopic.properties` 里有
  `"alignment-by-level": "actived"`（关闭为 `"inactived"`，部分模板缺该键）。
  这就是「格式 → 画布 → 同级主题对齐」，tooltip：自动统一同层级主题的宽度。
* 主干 5 个二级主题的 `topicG` 宽度都是 **264**，尽管标题长短差异很大
  （`智能网卡设备销售合同 2698万` vs `算力网络方案服务订单二 792万`）。
* 自建 `width-probe.xmind` / `width-probe-clockwise.xmind` /
  `width-probe-balanced.xmind`（两个一级分支、六个长短悬殊的二级主题）实测
  所有二级盒宽 = **222 px**，`textW=210`、padding 6/6。结论：对齐是
  **按 depth 全局**，不是按单个父主题，也不是按 side 分组。
* 浮动（detached）子树、summary / callout 是独立作用域：原版 example2 的
  detached 子树三个二级盒宽 273 / 273 / 287，并未参与主干对齐。
* 43 套 skeleton 样本大多**没有** `alignment-by-level` 键，故默认不对齐；
  不能把 `example2.xmind` 的对齐误当成全局默认。

### 30.2 实现

* `crates/xmind-core/src/layout.rs`：`LaidOutNode` 增加 `text_pad`；
  `make_node(..., m: Metrics)` 里
  `let text_pad = if style.align == "center" { 0.0 } else { h_pad(depth) * m.pad / 2.0 }`。
  `bare_cell()`、矩阵 banner 置 0。`resize_node()` 折行仍用 `width.max(60.0)`，
  `node_size()` 保持 `text_width() + h_pad` 的既有骨架校准（曾试 `ink_text_width()`
  使 15 套骨架整体变宽，已撤销）。
* `apply_alignment()` 改成按 `depth` 取最大宽；`compute_layout()` 的水平分支
  `Columns` 同步按 depth 统一（见 §12.3）。
* `crates/xmind-file/src/xmind.rs`：`from_content_json()` 用
  `alignment_by_level(&theme)` 写入 `Document.sibling_align`（兼容
  `actived/activated/true/on` 及 bool）；`sheet_to_json()` 前调用
  `sync_alignment_by_level()` 写回 `"actived"/"inactived"`；**原本无键且未开启
  的模板不新增键**，保证 `every_real_template_content_json_is_byte_faithful`。
* 前端 `src/lib/types.ts` 增加 `textPad`，`MapCanvas.tsx` 输出
  `--text-pad` 并给左对齐节点加 `.align-left`。`src/styles.css`：
  ```css
  .node.align-left:not(.underline) .node-title,
  .node.align-left:not(.underline) .node-title-input {
    padding-left: var(--text-pad, 0px); padding-right: var(--text-pad, 0px);
    width: calc(100% + 2 * var(--text-pad, 0px)); max-width: none;
    margin-right: calc(-2 * var(--text-pad, 0px));
  }
  ```
  宽度补偿是关键：直接给 `.node-title-input` 加 padding 会缩小可用宽度，
  CSS 折行比 Rust `title_lines()` 多一行，导致 `ui-rename` 报
  `scroll=160 client=120` 的垂直裁切。现在视觉左右内缩，但文字内容宽度
  仍等于原主题盒，折行与就地编辑框都不变。下划线主题只加 `padding-left`。

### 30.3 最终验证（9223）

* `open-sample.mjs example2.xmind` 走应用 UI 打开（recent 被
  `compare-skeletons.mjs` 覆盖成 15 个 skeleton 样本时会找不到菜单项，需先写回
  `settings.json` 再重启实例）；标题 `example2.xmind`、15 个节点、100% 缩放。
* 几何 `ours-node-geometry-release.json`：中心 `pad=0` 且居中；一级
  `padL=padR=18px`；二级 `padL=padR=6px`；主干 5 个二级盒宽全部 258.7 px；
  `scrollW == clientW`、`scrollH == clientH`（无裁切）。原版为 264 px，
  ≈5px 来自字体度量差异。
* 画布页签「同级主题对齐」= `checked: true`，证明原生 flag →
  `Document.sibling_align` → UI 的链路通了。
* 新增 `crates/xmind-core/tests/align.rs`（内边距分左右、按 depth 等宽）
  与 `xmind.rs` 底部两个 theme flag 单测；`cargo test --workspace`、
  `npx tsc --noEmit`、`npm run build:app` 全绿；`ui-theme-style` 22/22、
  `ui-skeleton-lines` 17/17、`ui-rename` all checks passed、
  `ui-marquee-summary` ALL PASS、`ui-verify` 无 FAIL、`compare-skeletons` exit 0。
* 产物：`target/verify/compare-padding-align.html`（自包含双图对照 + 数值表）、
  `ours-example2-final.png`、`ours-node-geometry-release.json`、
  `orig-topic-geometry.json`、`orig-width-probe*.json`。

## 31. 选中框 / 折行右溢出 / 帮助菜单（2026-11-16 深夜，第 6 轮）

用户三项反馈：① 点击选中主题时蓝框太大；② 长标题主动换行时主题右侧没
留间距、文字挤出背景色块；③ 帮助菜单只保留「快捷键命令」和「关于 xmind-rs」。

### 31.1 选中框：历史误测勘误

用 9222 打开 `example2.xmind`，真实 `Input.dispatchMouseEvent` 点击主题，
按 `data-view-id="topic-outline:*"` 抓 path 的 `getBoundingClientRect()`：

| 对象 | 形状盒 `topicG` | outline | 外扩 |
| --- | --- | --- | --- |
| 二级「智能网卡设备销售合同 2698万」 | `[1075,335,264,31]` | `[1073,333,268,35]` | 2 / 2 / 4 / 4 |
| 中心「深圳宏峰」 | `[591,391,170,67]` | `[589,389,174,71]` | 2 / 2 / 4 / 4 |

`stroke=rgba(46,189,255,1)`、`rx≈5`、多选同一规格。§21 表格里旧的
「20/12」来自把 **fo 文字区**当形状盒：一级主题 fo 相对 `topicG` 内缩
18/10px，二级 6/6px，加上 2px 框才凑出 20/12。自研原来直接用了
`x-20 / y-12 / w+40 / h+24`，所以框明显过大。改为 `x-2 / y-2 / w+4 / h+4`；
`MapCanvas.tsx` 注释、`styles.css` 注释、`ui-marquee-summary.mjs` 断言
（改为「四边各外扩 2px」）、§21 / §22.5 全部同步。真机复测
`dx=2 dy=2 dw=4 dh=4`。

### 31.2 自动折行主题的右侧留白

`target/verify/expr-ours-wrap.js` 用 `Range.getClientRects()` 量文字 ink，
与 `.node-shape path` 的 rect 比较：三个长标题折行主题的
`shapePadR` 为 **-1.5 / -3.7 / -2.1 px**（确实画到背景外）。原版同组主题
`topicG [1016.5,565,285,49]`、`fo [1022.5,571,273,37]`，第一行 ink 272.7
几乎填满 fo，但距形状右边缘仍有 **+6.3px**。

根因是 §30 的宽度补偿：`.align-left .node-title` 用
`width: calc(100% + 2*pad)` + `margin-right: -2pad` 把内容区右边界推到
`box.right + pad`。短文本 ink 短所以看不出来，自动折行的长行填满内容区就溢出。

修复（只作用于自动折行的左对齐主题）：
* 前端 `MapCanvas.tsx` 给 `node.lines > 1 && !title.includes('\\n') &&
  align === 'left' && !underline && textPad > 0 && !cell` 的节点加 `.auto-wrap`。
* `styles.css`：`.node.align-left.auto-wrap:not(.underline) .node-title[/-input]`
  把 `padding-right` 提到 `calc(var(--text-pad) * 3)`；元素框仍是
  `width + 2pad`，内容区变 `width - 2pad`，右边界回到 `box.right - pad`。
* Rust `layout.rs` 新增 `wrap_usable()` / `wrap_pad()`：`make_node()` 与
  `resize_node()` 对同一批节点用 `width - 2*pad` 重算 `lines`，和高度
  （`text_height * Δlines`）、`shape_path`、textarea `rows` 同步。

**关键约束**：不能对所有节点收窄。`wrap_ratio` 比盒宽用的 `char_ratio` 大，
`target/verify/simulate-wrap.mjs` 模拟显示统一收窄会让 example2 主干
**6/7 个单行主题**被误判成两行；显式 `\\n`、居中、下划线、单行主题必须
保持原来的全宽上限。实测修复后：三个长标题 `shapePadR` →
**+12.5 / +10.3 / +47.8px**，第三个行数 3→2（Rust 与 CSS 同步），
其余 12 个节点的 padL/padR/盒宽/行数全部不变，15 个节点
`scrollW==clientW`、`scrollH==clientH` 无裁切。

### 31.3 帮助菜单

`menuModel.ts::helpSubmenu()` 精简为两项：`hp.keys`「快捷键命令」
（`Ctrl+Shift+/`）与 `hp.about`「关于 xmind-rs」，删掉账号 / 登出 /
兑换礼品卡 / 资讯 / 支持 / 反馈 / 检查更新 / 入门 / 订阅信息及 4 条分隔线
（都依赖 XMind 在线服务或原本禁用）。`App.tsx` 弹窗标题同步改名，
删掉不再被引用的 `help.subscription` case，`SHORTCUTS` 里对应条目改名。
真机 `target/verify/check-help-menu.mjs` dump 可见行：
`["快捷键命令", "关于 xmind-rs"]`。

### 31.4 验证与产物

`cargo test --workspace`、`npx tsc --noEmit`、`npm run build:app` 全绿；
`ui-rename` all checks passed（`rows=2 scroll=80 client=80`）、
`ui-verify` 0 FAIL、`ui-skeleton-lines` 17/17、`ui-marquee-summary` ALL PASS、
`ui-theme-style` 22/22、`compare-skeletons` exit 0、
`ui-menus` ALL PASS（帮助子菜单的 3 条断言改为按精简规格校验；需在干净
5 主题文档上跑，否则 `nodeCentre('branch')` 找不到「分支主题」）。
产物 `target/verify/compare-round3.html`（自包含三图 + 数值表）、
`xmind-example2-selected.png` / `ours-example2-selected-r3.png` /
`ours-help-menu.png`、`orig-selection-*.json`、`orig-wrap-geometry.json`、
`ours-wrap-{before,after}.json`、`ours-help-menu.json`。
脚本：`probe-orig-click.mjs` / `shot-selected.mjs` / `check-help-menu.mjs` /
`expr-orig-wrap.js` / `expr-ours-wrap.js` / `simulate-wrap.mjs`。

---

## 32. Windows 任务栏显示文档名（2026-11-17）

### 现象与根因

任务栏按钮 / Alt-Tab 一直显示 `XMind RS`。`App.tsx` 里只有
`document.title = "● example2.xmind - XMind RS"`，那是 **WebView 页面标题**；
Windows 读的是**原生窗口标题**（`GetWindowText`），由 `tauri.conf.json`
的 `app.windows[0].title = "XMind RS"` 决定，运行期从未被改过。
`src-tauri/capabilities/default.json` 其实早已授予
`core:window:allow-set-title`，只是前端没有调用。

### 实现（`src/shell/App.tsx`）

```ts
function docLabel(path: string | null | undefined): string {
  return path ? path.split(/[\\/]/).pop() || '未命名' : '未命名';
}

// document.title 保持原样（页面标题仍带 ● 与 " - XMind RS"）。
useEffect(() => {
  void getCurrentWindow().setTitle(docLabel(snapshot?.path)).catch(() => undefined);
}, [snapshot?.path]);
```

* 任务栏只放**裸文件名**，不加 `●`、不加 `- XMind RS`：与自绘标题栏
  `.doc-name` 一致，未保存画布为 `未命名`；编辑状态由 `.doc-status`
  （空 / 已编辑 / 保存中...）单独表达，不污染任务栏。
* effect **只依赖 `snapshot.path`**：就地编辑每次按键都会产生新的 dirty /
  layout snapshot，若依赖整个 `snapshot` 会每键发一次 IPC；
  打开、另存为、新建、最近文件切换都会改变 `path`，四种路径全覆盖。
* `docLabel()` 同时供 `document.title`、`.doc-name` 与 `setTitle` 复用，
  避免三处 basename 逻辑漂移；`split(/[\\/]/)` 兼容 Windows 反斜杠与
  IPC 可能返回的斜杠路径。
* 权限已就位，无需改 capabilities / Rust；`setTitle()` 的 Promise 显式
  `.catch()`，避免权限缺失时产生未处理 rejection。

### 真机验证（`MainWindowTitle` 才是任务栏文字来源）

CDP 只能读 `document.title`，不能读原生窗口标题；用进程对象
`MainWindowTitle` 属性实测（PowerShell `Get-Process`）：

| 场景 | MainWindowTitle |
| --- | --- |
| 启动（空白画布） | `未命名` |
| 打开 `example2.xmind` | `example2.xmind` |
| 切到 `example.xmind` | `example.xmind` |
| Ctrl+N 新建 | `未命名` |
| 打开文档后编辑置 dirty | `example2.xmind`（不变，符合预期） |

注意终端表格输出偶尔会在末尾多打印一个 `X`（控制台噪声），
精确值用 `ConvertTo-Json` 复核：
`{"Title":"未命名","Length":3,"Codes":"26410,21629,21517"}`。

最终又用**从 GitHub Release 下载的 exe**（`gh release download v0.1`，
sha256 `4fee1c56…`）在独立数据目录启动复测：空白 `未命名` →
打开 `example2.xmind` 后 `example2.xmind`，端到端通过。

### 回归与发布

`npx tsc --noEmit`、`npm run build:app` 全绿；`ui-menus` ALL PASS、
`ui-marquee-summary` ALL PASS、`ui-rename` all checks passed、
`ui-verify` 0 FAIL、`ui-skeleton-lines` 17/17、`ui-theme-style` 22/22、
`compare-skeletons` exit 0。
`ui-marquee-summary` 在 `ui-menus` 之后直接跑会因残留选中/菜单状态
FAIL 3 项（外框范围手柄），先 `scripts/new-doc.mjs` 重跑即 ALL PASS，
与本次改动无关。

提交 `d6468dc`，推送 `main`。Release `v0.1` 的三个资产用
`gh release upload --clobber` 覆盖为新二进制，`RELEASE_NOTES.md` 顶部
加修订说明、`SHA256SUMS.txt` 更新（下载数 <3，避免制造版本碎片）；
`gh release download` 回拉校验哈希一致。

---

## 33. 菜单动作后自动隐藏整个菜单树（2026-11-17）

### 现象与根因

`文件 > 最近打开 > example2.xmind`：文档确实打开了（`.doc-name` 变成
`example2.xmind`、15 个节点），但屏幕上残留 **2 个 `.xm-panel` 和
`.xm-backdrop`**，遮住画布并吞掉后续点击。

`Menu.tsx` 的 `MenuLevel.activate()` 是：

```ts
onAction(entry);   // 执行动作（打开文档）
onClose();         // 但子菜单层的 onClose 只是 setSub(null) + focus 父层
```

`onClose` 是**逐层**回调：根层是 App 的 `setMenuOpen(false)`，子层是
父 `MenuLevel` 传下来的 `() => { setSub(null); ref.current?.focus(); }`。
所以从 depth=2 的「最近打开」列点叶子项，只关掉了 depth=2 那一列，
depth=0/1 面板和 backdrop 全留着。键盘 Enter 走同一个 `activate()`，
同样中招。这个 bug 影响**所有子菜单叶子动作**，不只是最近打开。

### 修复（`src/shell/Menu.tsx`）

把两种语义拆开，新增贯穿整棵菜单树的 `onDismiss`：

```ts
interface LevelProps {
  ...
  onClose: () => void;     // 只关当前层：Escape / ArrowLeft / 焦点回父层
  onDismiss: () => void;   // 叶子项激活后关掉整个 popup
}

const activate = (index, element) => {
  if (entry.submenu) { openSub(index, element); return; }
  onAction(entry);
  onDismiss();
};
```

* 根 `Menu` 把 `onClose` 同时作为 `onDismiss` 传给 depth=0 列；
  子级 `MenuLevel` 原样透传 `onDismiss`。
* `onClose` 完全不动：`MenuKeyBridge`（Escape 关全部）、ArrowLeft
  只退一层、hover 打开子菜单的行为都保持原样。
* 不把关闭塞进 `App.handleMenuAction`：键盘快捷键也走 `handleMenuAction`
  （`kbd:*`），在那里无条件关菜单语义不精确；关闭属于 Menu 组件职责。

### 回归

新增 `scripts/ui-menu-dismiss.mjs`（`CDP_PORT=9223 node scripts/ui-menu-dismiss.mjs`），
用真实 UI 点击断言：最近打开项 → 文档已打开 + `panels=0` + `backdrop=false`；
另一子菜单叶子动作（编辑 > 全选）同样关闭；Escape 仍能关掉整个菜单树
（`before=2 after=0`）。修复前复现为 `panels=2 backdrop=true`，修复后
**ALL PASS**。

其余回归全绿：`npx tsc --noEmit`、`npm run build:app`、
`ui-menus` ALL PASS、`ui-marquee-summary` ALL PASS、`ui-rename`、
`ui-verify` 0 FAIL、`ui-skeleton-lines` 17/17、`ui-theme-style` 22/22、
`compare-skeletons` exit 0。`scripts/open-sample.mjs` 截图前的
Escape + 空白点击保留为兜底，注释改为指向本回归脚本。

## 34. 启动文档与常驻滚动条（2026-11-17）

### 34.1 启动必须是干净的「未命名」

原版 XMind 每次启动都是一张新图：`中心主题` + `分支主题 1..4`（见 §2
`editor.js` 的默认结构与 `research/canvas-default.json`），标题栏 `未命名`。
xmind-rs 却在 bootstrap 里先调 `doc_restore`：

```ts
const restored = await api.restore();
const initial = restored ?? await api.newDoc();
```

`doc_restore` 读的是 `recovery/document.json`（每次 dirty 后 900ms 自动写的
快照），并且 `replace_document(document, None, None)` 把 path 置空。于是
「标题是 `未命名`，内容却是上次打开的文件」——正是用户看到的现象。

修复（`src/shell/App.tsx`）：bootstrap 只调 `api.info()` + `api.newDoc()`；
`doc_restore` 保留在 Rust 侧供**显式**恢复使用，但启动流程不再消费快照。
`Document::new()` 本身已经是原版的 5 主题骨架，不需要改模型。dirty 自动
写快照的逻辑保留（数据不丢，未来接「恢复未保存的导图」时仍可用），只是
不再决定启动内容。

### 34.2 滚动条常显且任意缩放可操作

原实现是「内容超出视口才出现」的 overlay 条：

```ts
const maxX = Math.max(0, contentW - bounds.w);
const showX = maxX > 1;
const factor = track > 0 ? range / track : 0;   // 10% 缩放时 range = 0
```

缩到 10%（或内容小于窗口）时两条滚动条直接消失；即使出现，缩放越小
`factor` 越接近 0，拖了也不动。

修复（`src/editor/MapCanvas.tsx`）把画布当无限平面，建一个虚拟世界：

```
padX  = max(SCROLL_OVER, bounds.w - contentW + SCROLL_OVER)   // 160px 起
worldW = contentW + 2*padX
offX   = padX                    // stage 左上角在世界中的 x
rangeX = worldW - bounds.w       // 恒 >= 2*SCROLL_OVER = 320px
scrollX = clamp(offX - view.tx, 0, rangeX)
posX   = scrollX / rangeX * (trackX - thumbW)
```

* `pad` 在视口比内容大时额外加 `(viewport - content)`，所以 `reset()`
  （`tx = 0`，内容贴左上角）也落在可导航范围内，滑块不会跳。
* `range` 恒大于 0 ⇒ 10% ~ 500% 每一档都能拖动，thumb 位置由
  `view.tx/ty` 反算，滚轮 / Space 平移时同步；pan 可以超出世界，但显示值
  clamp，拖滚动条时会把视图拉回范围内。
* `beginScroll(axis, event, jump)`：拖 thumb 用当前 clamp 后的 scroll 作起点；
  点轨道先按点击位置居中 thumb 再继续拖（`pointercancel` 也收尾）。
* 两条轨道 + 右下角块在 `ready`（ResizeObserver 量到尺寸）后恒显。配色取
  `research/vana.css` 的 `uk-win32` 常量：track `#FAFAFB` + `#E8E8E8` 内侧
  细线、thumb `#DADADB` / hover `#C6C7C9` / active `#B0B2B3`、10px gutter、
  8px 圆角滑块。

### 34.3 回归

新增 `scripts/ui-startup-scrollbars.mjs`（`CDP_PORT=9223` + 隔离数据目录，
目录里放一份真实的 `recovery/document.json` 与 `settings.json`）：20 项断言
覆盖「快照确实是另一个文档」「启动 5 主题 / 未命名 / 无已编辑」「两条滚动条
+ 角块常显」「10/50/100/300/500% 每档水平与垂直滑块都能拖」「点轨道跳转」
「滚轮平移时 thumb 同步」「打开 example2.xmind 后同样常显可拖」→ **ALL PASS**。
实测 10% 档 `tx 578.1→399.0 / posX 333.7→413.7`，500% 档
`tx -1704.3→-1944.7 / posX 620.5→700.5`。

其余回归全绿：`cargo test --workspace`（61 passed / 0 failed）、
`npx tsc --noEmit`、`npm run build:app`、`ui-menus` ALL PASS、
`ui-marquee-summary` ALL PASS、`ui-rename`、`ui-verify` 0 FAIL、
`ui-skeleton-lines` 17/17、`ui-theme-style` 22/22、`ui-menu-dismiss` ALL PASS、
`compare-skeletons` exit 0。滚动条常显占 10px 边缘，框选 / 范围手柄 /
就地编辑 / 主题样式均未受影响。

## 35. 工具栏按钮精简与「标记 / 插入」真功能（2026-11-17）

### 35.1 删除项与其保留入口

* 工具栏删掉 `ZEN`、`演说` 两个 `tool-item`（含 `.tool-flex.mid` 的 179px 空档
  与两个 `Icon` glyph），标题栏只剩 `主题 / 子主题 / 联系 / 概要 / 外框 /
  标记 / 插入 / 格式`。**功能本身没删**：ZEN 仍走 `Ctrl+Alt+F` / 查看菜单、
  `zen-exit` 按钮；演说仍走 `Ctrl+Alt+P` / 查看菜单 → 演示，PresentView 与
  `lib/pitch.ts` 保持可用（用默认配置）。
* 侧面板 `Inspector` 的 `Tab` 从 `style|present|canvas` 收成 `style|canvas`；
  一并删掉演说 tab 的预览 / 更换风格 / 长宽比 / 幻灯片 / 演说方式 / 布局 UI、
  5 个 `pitch*` popover 分支、`is-pitch` 类名、`onPitch` / `onPresent` 两个
  props 与 `App.setPitch()`，以及「查看 > 格式面板 > 演说」菜单行。
  `probe-pitch.mjs` / `ui-present-layout.mjs` 标记为 LEGACY（只适配旧版）。
* ZEN / 演说相关回归改为快捷键：`ui-tools.mjs` 用 `press('f','KeyF',70,3)`，
  `ui-verify.mjs` 用 `chord('p','KeyP',80,3)` 并等 1200ms 让 PresentView 的
  懒加载 chunk 挂载（280ms 会误报 `.present` 不存在）。

### 35.2 「标记 / 插入」原先为何等于没用

两个按钮都绑 `togglePanel('attrs')`：点「标记」只是把「主题属性」侧面板
开开关关，点「插入」也是开同一个面板；若面板已开则直接把它关掉，且不带
任何插入动作。菜单 `insert.note|label|marker` 也只是 `setPanel('attrs')`
+ 一句提示，没有写文档。

* 新增 `src/lib/markers.ts`：11 个 XMind 原生 `markerId` 按「优先级 / 任务进度 /
  旗帜 / 其他」分组，统一提供 `glyph` 与 `color`。画布角标
  (`MapCanvas`)、属性面板 (`TopicAttrs`)、工具栏弹层共用同一份定义；
  `MapCanvas` 旧的 `markerLabel()` 换成 `markerGlyph()` + 角标底色。
* 新增 `src/shell/ToolbarPop.tsx`：`MarkerPop`（点选即
  `run('toggleMarker', {id, marker})`，弹层保持打开可连加多个，再点取消）与
  `InsertPop`（19 行分 4 组，复用主菜单 / 右键菜单的 `insert.*` 动作名）。
  未选中主题时 `needsTopic` 行自动禁用，与原版一致。
* `App` 新增 `toolbarPop` 状态；`window` 捕获阶段 `pointerdown` 关闭弹层
  （弹层内与两个按钮用 `.tool-pop` / `[data-tool-pop]` 豁免），Esc 优先级
  排在 ZEN 之前；`marker` 与 `insert` 两个 `tool-item` 用 `position: relative`
  直接锚定弹层，z-index 90 压住菜单遮罩。弹层根加 `onMouseDown` 阻止冒泡，
  避免 `data-tauri-drag-region="deep"` 把点击空白当成拖窗口。
* `insert.note` / `insert.label` 改成真正的应用内输入弹窗，分别写
  `setNote` / `setLabels`（可回读）；`insert.marker` 直接切到标记弹层；
  `insert.attrs` 保留「主题属性…」入口，让属性侧面板仍可达。

### 35.3 回归

新增 `scripts/ui-toolbar-pop.mjs`（先跑 `new-doc.mjs`，CDP 9223）：30 项
**ALL PASS**，含按钮/tab 精简、11 个标记按钮、点标记后画布出现 chip 且
`doc_layout().nodes[0].markers == ["priority-1"]`、再点取消、Esc / 点空白关闭、
19 行插入下拉、无选中时禁用、插入子主题 5→6 节点、笔记写入回读、
主题属性面板打开、Ctrl+Alt+F / Ctrl+Alt+P 仍进入 ZEN / 演说。
脚本开头轮询等 React 首帧（CDP 端口先于页面就绪），并在检查 tab 前确保
「格式」面板已打开，避免上一轮遗留的 `panel='attrs'` 状态误报。

全套回归：`cargo test --workspace` 全绿、`npx tsc --noEmit`、
`npm run build:app`、`ui-menus` / `ui-marquee-summary` / `ui-rename` /
`ui-verify` / `ui-tools` / `ui-skeleton-lines` 17-17 / `ui-theme-style` 22-22 /
`ui-menu-dismiss` / `ui-startup-scrollbars` 20 项 ALL PASS /
`compare-skeletons` exit 0。注意 `ui-theme-style` 必须先
`open-sample.mjs example.xmind`，`ui-startup-scrollbars` 必须在刚启动的实例上
第一个跑，否则会因当前文档不是「未命名」而误报。

## 36. 「最近打开」上移一级到「打开」下面（2026-11-17）

### 36.1 结构与实现

原版 XMind 把「最近打开」放在 `文件` 子菜单第 4 行，且它自己还有一层子菜单，
即要点三次（主菜单 → 文件 → 最近打开 → 文件）。产品要求把它**上移一级**，
直接放在主菜单「打开」的正下方：

```
撤销 / 重做 / --- / 新建 / 打开 / 最近打开 / --- / 保存 / 另存为 / ...
... / 文件 / 编辑 / 插入 / 工具 / 查看 / 帮助
```

* `src/shell/menuModel.ts`：抽出 `recentSubmenu(ctx)`（历史文件 +
  `sep` + 清空目录），`buildMainMenu` 在 `m.open` 之后插
  `item('m.recent', '最近打开', { submenu: ... })`；`fileSubmenu()` 删掉该行并
  改成无参（否则 `noUnusedParameters` 报错）。子项 id 从 `fi.recent.*` 统一成
  `m.recent.*`，`recent.open` / `recent.clear` 动作与 payload 完全不变。
* 「文件」列删掉该行后，原来紧跟其后的 `fi.sep1` 保留，分组其它条目顺序不变。
* `MenuLevel.activate()` 的注释同步：`最近打开 > foo.xmind`（不再经过「文件」）。
  叶子动作的 `onDismiss()` 从根层透传，少一层后依然能关闭整棵菜单树。

### 36.2 回归脚本的「有意偏离」

`ui-menus.mjs` 仍以 `target/app-menu-full.json` 为原版事实来源，但明确标注这一处
偏离：`expTop` 在「打开」后插入一行「最近打开」再与实测比较；「文件」列的
expected 过滤掉「最近打开」。新增三条断言：`最近打开` 位于 `打开` 下一行且带
子菜单、只展开一层面板（`panels=2`）、子菜单末项仍是「清空目录」。
`open-sample.mjs` / `ui-menu-dismiss.mjs` / `ui-startup-scrollbars.mjs` 的 UI 路径
从 `['文件','最近打开']` 改成 `['最近打开']`；`ui-menu-dismiss` 的 Escape 用例也
改成 hover 新的一级行。捕获 JSON 不改，保持原版事实来源的纯粹性。

### 36.3 真机验证

隔离实例（CDP 9223，`target/verify-toolbar/{data,wv2}`）：`ui-menus` **ALL PASS**
（顶层 21 行、`open=4 recent=5`、「文件」列 14 行只少「最近打开」）、
`ui-menu-dismiss` ALL PASS、`ui-startup-scrollbars` 20 项 ALL PASS（新路径确实能
打开 `example2.xmind`）、`open-sample example.xmind` 正常、`ui-theme-style` 22/22、
`ui-toolbar-pop` 30 项 ALL PASS、`ui-marquee-summary` / `ui-rename` / `ui-verify` /
`ui-tools` / `ui-skeleton-lines` 17/17 / `compare-skeletons` exit 0 全绿；
`cargo test --workspace` 61 passed / 0 failed、`npx tsc --noEmit`、
`npm run build:app`。截图 `target/verify/recent-menu-first-level.png`。

注意 `ui-menus.mjs` 仍需在**干净新文档**上跑（先 `new-doc.mjs`），否则画布里
找不到「分支主题」会在主题右键用例处崩；`compare-skeletons.mjs` 跑完会覆盖
隔离目录 `settings.json` 的 recent，需写回含 `example2.xmind` 的配置。

## 37. ZEN / 演说 两个模式整体删除（2026-11-17）

§35 只摘掉了工具栏按钮与侧面板入口，功能本体（ZEN 模式切换、`PresentView`
播放层）仍挂在 `Ctrl+Alt+F` / `Ctrl+Alt+P` 与「查看」菜单上。本次把两个模式
的代码全部清空，应用里不再有任何进入路径。

### 37.1 删除清单

* 前端文件：`src/shell/PresentView.tsx`、`src/lib/pitch.ts`（PITCH_* 常量 +
  `buildSlides` 幻灯片推导）、`public/pitch/*.svg`（7 张风格缩略图，仅演说面板用）。
* `App.tsx`：`zen` / `presenting` 两个 state、`PresentView` 懒加载、
  `view.zen` / `view.present` 两个 action 分支、`if (presenting) return;` 的
  键盘让位、Escape 里的 ZEN 退出分支、`Ctrl+Alt+F` / `Ctrl+Alt+P` 两条快捷键、
  `.app.zen` 类名与 `zen-exit` 浮层、`menuContext.zen`。
* `menuModel.ts`：`MenuContext.zen`、「查看 > ZEN 模式」、「查看 > 演说模式」
  子菜单（演示 / 在窗口中演示 / 演说者视图）、快捷键表里的 `Ctrl+Alt+F / P` 行。
  删掉两行后原本夹在中间的两个分隔线合并为一个（`vw.sep3` 保留、`vw.sep4` 去掉）。
* `styles.css`：`.app.zen` / `.zen-exit`、`.pop.is-pitch` 与 `.pitch-*`、
  `.present*` / `.ps-*` 五大布局（共 5027 字符尾部块）、以及演说页签遗留的
  `.fp-preview*` / `.fp-btn-flat` / `.fp-section-top`。
* `types.ts` / `api.ts`：`PitchSettings`、`Document.pitch`、`api.setPitch`。
* Rust：`xmind_core::model::PitchSettings` 与 `Document.pitch` 字段、
  `commands::doc_set_pitch` 及其注册、`xmind-file` 两处 `pitch: Default::default()`。
  `pitch` 从未写进 `.xmind`（两份读取路径都只给默认值），是纯内存死状态；
  serde 默认忽略未知字段，旧快照 / 旧导出里若还带 `pitch` 也不会报错。
* 脚本：删除 `probe-pitch.mjs`、`ui-present-layout.mjs`（原本已标 LEGACY）。

### 37.2 回归脚本的反向断言

`ui-tools.mjs` 第 4 段、`ui-toolbar-pop.mjs` 第 6 段从「仍可进入」改成
「不再生效」：按 `Ctrl+Alt+F` 后 `.app.zen` 不存在、`zen-exit` 不存在，
按 `Ctrl+Alt+P` 后 `.present` 不存在。`ui-verify.mjs` 末尾只打印
`present: removed` 并截图。`ui-menus.mjs` 新增两条有意偏离断言：
「查看」子菜单比对先剔除 `ZEN 模式` / `演说模式` 并合并连续分隔线，
再单独断言整列不含这两个词。

### 37.3 真机验证（CDP 9233，`target/verify-zen/{data,wv2}`）

`ui-toolbar-pop` 30 项 ALL PASS、`ui-menus` ALL PASS（「查看」20 行，
无 ZEN / 演说；`got` 列里 `仅显示该分支|---|导航面板` 说明分隔线已合并）、
`ui-tools` all checks passed、`ui-verify` 正常、`ui-startup-scrollbars` 20 项
ALL PASS、`open-sample example.xmind`（72 节点）、`ui-rename` ALL PASS；
`npx tsc --noEmit`、`cargo test --workspace`、`npm run build:app` 全绿，
构建产物里已没有 `PresentView` / `pitch` 分块。


## 38. 骨架按层级形状：第 3 级及以下必须是实心圆角矩形（2026-11-17）

### 38.1 现象与两个根因

用户反馈：新建画布后逐级添加子主题，原版在「思维导图」第一个骨架下
**每一级**都是实心圆角矩形；本应用第 3 级及以下变成纯文字。

实测（`scripts/probe-level-shapes.mjs`，43 preset × 两种时序 × 5 级）：

```
思维导图 1  appliedLast  L1 roundedRect/#000229  L2 roundedRect/#0098B9
                         L3..L5 roundedRect/none
            appliedFirst L1..L5 全部 roundedRect/none（骨架样式没传下来）
```

两个独立根因：

1. **`doc_apply_skeleton` 只把样式写进「当时已存在」的主题**
   （`ops::apply_skeleton_styles` 遍历 root → 一级 → 所有二级以下 attached）。
   XMind 的骨架是 `sheet.theme` 的 **centralTopic / mainTopic / subTopic
   三层**，按 depth 解析，所以切换骨架之后新建的主题自动带上该层样式。
   本应用把它降格成了 per-topic `topic.style`，于是「先选骨架、再加子主题」
   这条路径从第 2 级开始就完全丢失预设。
2. **`style_for` 的 depth >= 2 基线写死 `fill: "none"`**。就算骨架把所有
   已存在主题的 `shape-class` 改成 `roundedRect`，也没有任何东西给它填充；
   外来主题才走 `apply_theme_layer` 的分支色引擎（§29），新建文档不走。

### 38.2 事实来源（原版桌面版，不是推测）

* `research/skeleton-themes.json`：从本机 XMind 23.07 bundle `8846.js` 抽出的
  **43 份完整 `sheet.theme`**。三层 `shape-class` 分布见 §27。
* 三层 `svg:fill` 只有两种取值：**缺键 48 处**（交给配色主题引擎画板）与
  **显式 `none` 81 处**（不画板）；没有任何一层写死颜色。第 1 个思维导图
  骨架 `db4a5df4…` 三层都是 `roundedRect` + 缺 `svg:fill`，即三级以下同样
  是实心板。`level3` 层在这 43 套里**一次都没出现**，所以 depth 2/3/4/5
  共用 `subTopic`。
* 缺 `svg:fill` 时每级填充来自分支色引擎，色值由 §29.1 原版 DOM 实测给出：
  中心近黑、一级实心分支色、二级及以下 20% 洗色 + 40% 暗墨。
* 本轮原版 CDP 9222 实例起不来（环境把 `WMIC.exe` 列入程序黑名单，
  XMind 主进程 10 秒后自行退出），因此**没有新拍的 9222 截图**；上面的
  主题字节与 §24/§29/§30 的历史 DOM 实测都是既有事实来源。

### 38.3 实现

* `theme_style.rs` 新增 `SkeletonLayer { shape, filled, border }` /
  `SkeletonLayers { central, main, sub }`，`SKELETON_KEY =
  "xmindRsSkeleton"`。这是一份**sheet 级**样式，存在 `sheet.extra`；
  `parse_sheet` / `sheet_to_json` 都会原样保留，存盘再打开不丢。
* `scripts/build-skeleton-data.mjs` 从 43 份主题生成每套 preset 的
  `layers`：短形状名、`filled`（`svg:fill` 不是 `none`）、
  `border`（`border-line-width` 去 pt 取 px）。`skeletons.ts` 同步重生成；
  `api.applySkeleton` / `App.setSkeleton` 多带一个 `layers` 参数；
  `doc_apply_skeleton` 用 `ops::set_skeleton_layers` 落到 sheet。
  `apply_skeleton_styles` 的 per-topic 补丁保留（真实 XMind 打开我们存的
  文件时仍读得到三层样式）。
* `doc_new` 写入 `SkeletonLayers::mind_map()`（三层实心 roundedRect），
  即新画布默认就是「思维导图 1」。
* `compute_layout` 把 sheet 上的 layers 挂到 `ThemePalette.skeleton`；
  `style_for` 在 `sheet.theme` 之后、用户 `topic.style` 之前按 depth 应用：
  `filled=true` → depth 0 中心色 / 1 分支色 / >=2 `blend_over(branch, #fff, .2)`
  + `darken(branch, .4)` 墨色；`filled=false` → 无填充，`border>0` 时描分支色边；
  下划线形状不画板，规则色宽沿用 `underlineColor/underlineWidth`。
  `bare_cell()` 仍覆盖树型表格 / 矩阵图单元格。
* 回归：`crates/xmind-core/tests/skeleton_levels.rs` 3 项（5 级全实心、
  后来新增的第 5 级也继承、下划线骨架仍无板、sheet 往返）；
  `crates/xmind-file/tests/roundtrip.rs` 增 1 项 `.xmind` 存读不丢 layers；
  `scripts/probe-level-shapes.mjs` 采集 44 行 × 2 时序 × 5 级；
  `scripts/ui-level-shapes.mjs` 按 43 份原版主题逐项断言形状 + 是否有板；
  `scripts/ui-level-plates.mjs` 用键盘 Tab 连加 4 级并直读 DOM
  `<path fill=…>` 与圆角路径。

### 38.4 对比结果（至少到第 5 级）

| 阶段 | 与 43 份原版主题比对 |
| --- | --- |
| 修复前 | 28 / 43 套骨架存在层级差异（第 3–5 级缺板、显式 `svg:fill: none` 的中心/一级反而画了板、先选骨架再加主题时整条链丢失预设） |
| 修复后 | 44 行（43 骨架 + 默认新画布）× 2 时序 × 5 级 = **932 项断言全绿** |

**三种结构性例外**（原版 DOM 实测，见 §24 / §12.3 / §15.5，回归里显式编码，
不是漏测）：括号图主题只留文字、大括号承担结构；树型表格所有主题是透明
单元格；矩阵图是白色横幅 + 文字列头 + 二级下划线。它们的填充由结构决定，
不跟 `sheet.theme` 走。

**仍未还原**（沿用 §27 的既有清单，不属于本次层级形状问题）：
`stack` / `singlebreakangle` / `squareBracket` 等异形路径仍回退圆角矩形、
手绘笔刷的 hachure 纹理、18 种箭头、pt→px 字体度量、矩阵列头整列色带。
另外本轮没有新的原版 9222 DOM 截图，不能声称像素级一致。

### 38.5 真机验证

`npm run build:app` / `npx tsc --noEmit` / `cargo test --workspace`（65 项）
全绿。CDP 9235/9236/9237 隔离实例：`ui-level-shapes` 932 项 ALL PASS、
`ui-level-plates` 5 级 `fill=#000229 / #0098B9 / #cceaf1 ×3` 且路径均为
`M 8 0 H … A 8 8 …`、`ui-menus` / `ui-toolbar-pop` 30 / `ui-tools` /
`ui-rename` / `ui-marquee-summary` / `ui-verify` / `ui-menu-dismiss` /
`ui-skeleton-lines` 17/17 / `ui-theme-style` 22/22（先 `open-sample
example.xmind`）/ `ui-startup-scrollbars` 20 项全绿。
`compare-skeletons.mjs` 本轮未跑（需要原版 9222 实例）。

## 39. 画布 > 配色方案：下拉每个选项对应 6 个单色变体（2026-11-17）

**问题**：侧面板「画布 → 配色方案」把下拉（缤纷 / 经典两套画廊）与下方
3×2 快捷卡写死成 6 个固定方案，切换下拉选项时下方卡片不变，逻辑不成立。

**原版事实**（CDP 9222，不带独立 profile 直接带文件路径启动即可）：
弹层 `.smart-color-theme-group` 分「缤纷 / 经典」两组画廊；选中一个方案后
下方固定 6 张 `.uk-card.uk-card-selectable`，是**该方案 6 个主色各自作为主色
的单色变体**（「永恒」= `#3949AB / #E53935 / #C0CA33 / #00897B / #1E88E5 /
#8E24AA`）。选方案时保持多彩（card 0 active），**点某张卡片**才切到单色搭配。
`research/asar-src/renderer/2907.js` 内嵌 513 个 theme 预设（`tags` 分组 +
`colorFieldsMap` + `theme`），按 `tags` 且 `!hidden` 过滤得到 32 套可见方案，
每套 6 个变体。

**实现**：`scripts/build-palette-data.mjs` 由 bundle 生成
`src/inspector/palettes.ts` 的 `variants`（禁手改生成文件）与
`public/tiles/palette-variants/` 共 192 张 SVG 缩略图；`Inspector.tsx` 的
`QUICK_PALETTES` 换成 `activePalette.variants`，6 张卡随下拉即时联动。
变体索引持久化到 `sheet.extra["xmindRsPaletteVariant"]`，经
`Document.palette_variant` → `doc_set_canvas` → `api.setCanvas` 全链路往返，
`.xmind` 存读不丢（`roundtrip.rs::palette_variant_roundtrips`）。
回归 `scripts/ui-palette-variants.mjs` 31/31（含真机存盘往返）。

## 40. 下划线主题：连线端点必须与下划线重合（2026-11-17）

**用户猜测**：「当主题显示样式为下划线时，与该主题连接的线，都与它的
下划线垂直对齐」。原版 DOM 实测证明成立，且比猜测更严格。

**原版事实**（CDP 9222 + `example.xmind`，采集脚本
`scripts/probe-orig-underline.mjs`，结果 `target/verify/underline/
orig-underline.json` / `orig-attach.json`）：

| 量 | 实测 |
| --- | --- |
| 端点总数 | 126（63 条连线 × start/end），全部是下划线主题 |
| 端点 y | **126 / 126 满足 `y == rect.bottom == underlineY`**（盒底） |
| 端点 x | `dx <= 0.71`，即落在 `rect.x` 或 `rect.x + rect.w`（盒左右边缘） |
| 下划线本体 | `topic-node-border` 零高度水平描边，`border.w == rect.w`（满盒宽）、`border.y == rect.y + rect.h`（盒底） |

也就是说：原版下划线是**主题盒底一条满宽的零高度 SVG 描边**，连线两端
正好落在它的左右端，视觉上是连续的一笔（见 `orig-underline.png`）。

**本应用此前的偏差**（`app-before.png` 对照）：

1. 下划线是 `.node-title` 的 CSS `border-bottom`，`width: auto` 只贴合文字，
   比盒窄 4~6.7px（左对齐一级主题左侧还差 18.85px）；
2. 位置在 label 底边，比盒底高 3.19px（单行）/ 6.06px（多行）；
3. 连线端点 x 按**主题盒边缘**算，而 CSS 下划线端点在**文字边缘** ——
   坐标空间不同，线从下划线末端「戳出去」；
4. 连线在 `.edges` SVG 层，下划线是 DOM 元素（`z-index: 1`）盖在其上，
   无法「续接」；
5. 导出 SVG 反倒画的是满盒宽、盒底 -2px 的线，与画布又不一致。

第 1 轮只把端点 y 从盒中心挪到 label 底边（`branch_anchor_y` 的
`(height + title_height)/2`），用户反馈「有所改善，但没完全改对」——
y 接近了，x 与三者一致性没解决。

**修复（三处统一到盒底 + 满盒宽）**：

- `src/styles.css`：`.node.underline::after` 绝对定位
  `left: 0; right: 0; bottom: 0; height: var(--ulw);
  background: var(--ul); transform: translateY(50%)` —— 描边中心正好落在
  `box.bottom`。移除 `.node.underline .node-title[/-input]` 的
  `border-bottom`，避免第二条贴合文字的线。
- `crates/xmind-core/src/layout.rs::branch_anchor_y`：下划线主题直接返回
  `node.y + node.height`（盒底），普通实心形状仍用盒中心。
  新增 `branch_start_x`：父主题是下划线时去掉历史的 `h_pad * pad` 内缩，
  让出线点落在盒边缘（下划线端点）；实心父主题保持原内缩不变。
- `crates/xmind-file/src/export.rs`：下划线 `<line>` 的 y 从
  `box.bottom - 2` 改到 `box.bottom`；`fill == "transparent"` 的表格单元格
  保留原 2px 内缩分隔线（它们没有 CSS `::after`，不是下划线主题）。

**绘制/计算顺序**（回答用户提问）：
- 计算：`compute_layout` 先摆主题盒 → `build_edges` 由盒派生端点 →
  `build_braces` / `build_decorations` → 组装 `Layout`。端点由主题派生。
- 绘制：`.stage` 内全部 `position: absolute` 且大多无 `z-index`，层叠由
  DOM 顺序决定：`edges` → `decor-layer` → `nodes` → `drop-layer` →
  `selection-layer`（线在底、主题在上，与原版一致，不是问题所在）。
  真正的问题是下划线从 SVG 描边变成了 DOM/CSS 元素且宽度收窄。

**回归**：`crates/xmind-core/tests/underline_edges.rs` 2 项（端点 y/x 精确
落在盒底与盒左右边缘；下划线父主题的出线点也在自己的规则上；实心主题
仍保持中心连接）。`scripts/ui-underline-align.mjs` 校验后端端点、DOM
`::after` 几何、导出 SVG `<line>` 三者一致并出截图。
`scripts/ui-theme-style.mjs` 的下划线 DOM 断言由读 `.node-title` 的
`borderBottom` 改为读 `::after` 的 background / height / left / right /
bottom / transform，并新增「label 不再画第二条线」。

## 41. 工具栏「标记」面板（原版代码事实）

事实来源：`research/asar-src/renderer/2907.js` 的标记注册表 / 分组名 /
英文标记名，`761.js` 与 `9869.js` 的 `marker-panel` 组件，以及
`editor.js` 的 `workbench.toggleMarkerPanel` 命令实现。

- 原版工具栏「标记」的命令是 `workbench.toggleMarkerPanel`，打开的是右侧
  `QN.IMAGE` 图标面板的 `MARKER` 页，不是工具栏正下方的小型下拉。本应用
  保留自己的工具栏锚定弹层，但内容按该官方面板还原。
- 官方分组顺序由 `mA` 决定；过滤 `group.hidden === true` 后可见 7 组：
  标签(8)、优先级(7)、任务(7)、旗帜(7)、星星(7)、人像(7)、符号(15)，
  共 58 个可见标记。每个标记再过滤 `hidden === true`。
- 面板 DOM：`.marker-module > ul.group-list > li.group > h5.group-title`
  加 `.uk-flex.uk-flex-wrap` 图标容器；每个图标是 26×26 的 `.icon-image-item`，
  内含 24×24 `<img>`，间距 6px。顶部有「显示图例 / 隐藏图例」按钮。
- 点击标记走 `editor.addMarker` → `mutate:addMarker`：先把同 id 去重，再追加
  到数组末尾；已存在时无变化，因此是**幂等添加**，不是双击取消。移除由
  `editor.removeMarker` / 主题属性面板负责。
- `scripts/build-marker-data.mjs` 从 2907.js 提取注册表与名称，从
  `C:/Users/DM/AppData/Local/Programs/Xmind/resources/app.asar` 提取 58 个
  官方 SVG，生成 `src/lib/marker-data.ts` 与 `public/markers/**`。两者都是
  生成文件，禁止手工修改。

## 42. 标记面板的真机 CDP 9222 复核（2026-11-17）

用户关闭可见窗口后仍有残留 `Xmind.exe`（无窗口、PID 21704）会接管新进程；
从本会话 `Stop-Process` 被拒绝访问。最终用本机直接启动
`env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS Xmind.exe --remote-debugging-port=9222
--allow-file-access-from-files example.xmind`（不指定 `--user-data-dir`）成功拿到
`editor.html` 调试页；若再遇到接管，需由用户手工结束残留 `Xmind.exe`。

原版选中中心主题并点工具栏「标记」后的面板 DOM 实测：

- 面板是 `.icon-panel.uk-icon-module`，`getBoundingClientRect().width === 268px`，
  `right: 28px`；顶部 `.uk-tab` 一行是三个 **72×20** 页签，图标分别来自
  app.asar 的 `static/assets/images/icon-module/{marker,sticker,illustration}.svg`
  （16×16），最右是 20×20 的关闭按钮；页签下方一条 `<hr>`。
- 图例按钮是 `button.legend-toggle-btn.uk-button-floating.uk-width-1-1`，
  文案在「显示图例 / 隐藏图例」间切换，点击后列出本图已用标记与说明；
  按钮不是搜索框。
- `.marker-module` 内仍是 §41 记录的 7 组 / 58 个 26×26 图标格（24×24 `<img>`、
  gap 6px）。点击标记后图标 DOM 上**没有** added/active/selected 类，官方面板
  不显示选中高亮；同 id 重复点击仍为幂等添加。
- 本应用据此补齐：`.tp-tabs` 三个官方 16px 页签、`.tp-close` 关闭按钮、
  268px 面板宽度、圆角图例按钮，并移除 `.tp-mark.on` 选中高亮。
  `scripts/build-marker-data.mjs` 同时生成 `public/markers/ui/*.svg` 与
  `MARKER_UI`，仍是生成文件。真机回归见 `scripts/ui-toolbar-pop.mjs`。

## 43. 标记：每组一个 + 画在主题文本框里（2026-11-17）

### 43.1 真机事实（CDP 9222，example.xmind）

`scripts/probe-orig-marker-layout.mjs` 从工具栏点标记，逐次读
`[data-view-id^="topic-node:"]` 的 `topic-content` 子树：

- 同组替换、跨组累加：中心主题点 `tag-red` → 只有 `topic-marker:…:tag-red`；
  再点 `tag-orange` → 同一槽只剩 `tag-orange`；再点 `priority-1` →
  `topic-marker-group` 里同时有 `tag-orange`（x=0）与 `priority-1`（x=40）；
  再点 `priority-2` → 第二槽变成 `priority-2`。原版不显示面板选中态，
  所以「幂等添加」（§41）只指同 id 重复点击，**不是**每组可累加。
- 主题盒内只有一个 `topic-marker-group` 和一个 `topic-title`（另外才是
  `topic-image-group` 这类内容），二者同处 `topic-content`，标记在左、同一行。
- 标记本体：36×36 `<image href="data:image/svg+xml;base64,…">`（官方 24×24
  SVG 放大）+ `topic-marker-border` 圆形描边 `stroke=rgba(255,255,255,1)`
  `stroke-width=6`，变换 `translate(6,6)`；圆环视觉直径 42px。
- 几何：每个标记槽 40px（SVG 用户单位），后续标记 `translate(40n,0)`；
  标题起点相对 `topic-content` 为 x=58（1 个标记）和 x=98（2 个标记），
  即 `40n + 18`，末尾标记到文字净距 13px。主题盒从 181.6px 增到 209.54px
  （屏幕坐标，视图缩放 69%），标题 `foreignObject width=144` 始终不变——
  标记撑大盒子，不压缩标题折行上限。

### 43.2 实现

- 目录映射与互斥规则在 `src/lib/markers.ts`：`markerGroupOf()`、
  `addMarkerExclusive()`（同组原位替换、跨组追加、同 id 不变）、
  `toggleMarkerExclusive()`（属性面板点已选标记则移除）。
- 新增 `ops::set_markers` + `doc_set_markers` IPC（`src-tauri/src/lib.rs`
  注册、`src/lib/api.ts`、`App` 动作分派），一次写入完整数组 = 一次撤销；
  保留 `doc_toggle_marker` 仅作兼容，工具栏和属性面板不再调用它。
- `layout.rs`：`MARKER_SLOT=40`、`MARKER_TRAIL=18`，
  `marker_width()` 返回 `n*40+18`（n=0 时为 0），`LaidOutNode.marker_width`
  让 `make_node`/`resize_node` 以 `width - marker_width` 作为文字可用宽度，
  盒宽与折行上限同步且互不挤压（紧凑布局沿用 `m.pad` 缩放）。
- 画布：`.node-markers` 从绝对定位的左上角角标改为 `.node-title` 之前的
  flex 子项；40px 槽、36px 官方 SVG、`box-shadow:0 0 0 3px #fff` 白环、
  图标 `translateX(4px)`、行尾 18px 间距，整体随 `.node` 的
  `justifyContent` 对齐。未改动 edges → decor → nodes 的绘制顺序。

### 43.3 回归

`CDP_PORT=9223 node scripts/ui-marker-inbox.mjs` 13/13：盒宽 +98、
`markerWidth=98`、折行数不变、两枚 40px 槽、36px 图标与白环、
行在盒内且位于标题左侧同一行、两次同组点击均为替换。
`ui-toolbar-pop.mjs` 38/38、`cargo test --workspace` 全绿。
对比截图：`target/verify/marker-layout/03-priority-1.png`（原版）与
`target/verify/marker-inbox/inbox.png`（本应用）。

调试注记：debug exe 走 Vite `localhost:1421`，必须先 `npm run dev`；
直接 CDP `invoke('doc_set_markers')` 只更新 Rust 文档而绕过 React，
回归必须驱动真实工具栏点击。

## 44. 工具栏「插入」：原版 5 项 + 三页签素材面板（2026-11-18）

### 44.1 原版行为（CDP 9222 + ffmpeg 全屏截图）

原版「插入」是 Electron **原生置顶菜单**，CDP target 数和 DOM 都搜不到下拉，
只能靠 `ffmpeg -f gdigrab -i desktop` 截系统屏幕（见 §42 的启动方式）。
`target/verify/insert-menu/menu-zoom3.png` 确认完整菜单为 9 项、3 组、2 条分隔线：

1. 笔记 / 标签 / 链接▶
2. 附件 / 语音备注
3. 贴纸 / 插画 / 本地图片 / 方程

按需求只保留 **笔记、标签、贴纸、插画、本地图片**，去掉链接、附件、语音备注、
方程；分隔线落在「笔记·标签」与「贴纸·插画·本地图片」之间。

逐项真机操作（`target/verify/insert-actions/*.png`）：

- **笔记**：在选中主题**下方**出现浮动富文本编辑器（`01-note.png`），顶部有
  B/I/U、对齐、列表按钮，内容写入该主题的 note；不是应用自己的模态输入框。
  已有笔记的主题在盒子右上角挂一枚**折角纸页图标**，点击可重新打开笔记。
- **标签**：同样在主题下方浮动（`02-label.png`），标题「标签」，提示
  「多个标签请用半角逗号隔开」，内容写入 topic.labels。
- **贴纸**：打开右侧 `uk-icon-module` 图标面板的**第 2 页签**（`06-sticker.png`），
  页签下方是「类别：全部」下拉 + 5 列网格；点击后主题盒左上角出现小图
  （`sticker-applied.png`），面板**保持打开**，无 active/selected 高亮。
- **插画**：同一面板**第 3 页签**（`07-illustration.png`），同样带类别筛选；
  13 组 468 张贴纸与 5 组 40 张插画由 `scripts/build-icon-assets.mjs` 从
  asar + 面板 DOM 生成到 `src/lib/icon-data.ts` 与 `public/{stickers,illustrations}/`。
- **本地图片**：Windows 原生「打开」对话框，过滤 `*.png;*.jpg;*.jpeg`。

### 44.2 实现

- `src/shell/ToolbarPop.tsx`：`INSERT_GROUPS` 从旧 19 行改为 5 行；`MarkerPop`
  扩展成三页签共享面板：标记页保持 7 组 58 个与「显示图例」，贴纸/插画页
  增加「类别」下拉、5 列 36px 图标网格与滚动区。图标模式按原版固定在窗口
  右侧（`right:28px; top:56px`），点击素材后面板不关闭。
- `src/lib/icon-data.ts` 增加导出的 `IconItem` 类型；生成器
  `scripts/build-icon-assets.mjs` 同步修改（生成文件仍禁手改内容）。
- `src/shell/App.tsx`：
  - 笔记/标签改为主题下方就地浮层 `topic-inline-editor`，跟随画布 pan/zoom；
    `MapCanvas` 通过 `onViewChange` 上报视图，关闭时一次性写回 note/labels。
  - `MapCanvas` 在 `node.note` 非空时渲染 `.node-note` 折角纸页角标（右上角、
    17×17、z-index 3），点击选中主题并重新打开笔记浮层；角标不进入布局，
    不改变盒宽与折行。
  - 贴纸/插画走 `fetch(SVG) → Blob → data URL → api.resourcePut → run('setImage')`，
    与本地图片共用 content-addressed 资源链路，因此 `.xmind` 保存后资源随文档走。
  - 插入 > 贴纸/插画直接以 `markerTab` 打开共享面板的对应页签。
- `src/editor/MapCanvas.tsx`：新增 `onViewChange` 回调；绘制层级未变。
- `src/styles.css`：三页签按钮 reset、`.tp-icon-*` 网格、`.topic-inline-editor`
  浮层样式。

### 44.3 回归

`CDP_PORT=9223 node scripts/ui-toolbar-pop.mjs` 全绿（含 5 项精确断言、
禁用态、笔记/标签写入回读、笔记纸页角标与点击重开、类别筛选、
贴纸/插画写入 `topic.image` 资源、面板不自动关闭、Esc/外部点击）。
`npm run build` 与
`CARGO_INCREMENTAL=0 cargo test --workspace` 全绿（仅一个既存 unused 警告）。
截图：`target/verify/toolbar-insert-pop.png`、
`target/verify/toolbar-icon-panel-sticker.png`、
`target/verify/toolbar-icon-panel-illustration.png`、
`target/verify/insert-note-badge.png`（以及放大图 `-zoom2.png`）。

未做像素级承诺：笔记浮层未还原富文本 B/I/U 的实际格式化语义（仅保留原版
视觉工具条），笔记/标签浮层位置按主题盒下方锚定而非原版内部布局引擎坐标。

## 45. 标记在 content.json 里必须是对象数组（2026-11-18，原版打不开本应用文件）

### 45.1 症状

本应用保存的 `.xmind`（含标记）用原版 XMind 23.07 打开：画布空白、状态栏
`主题: 0`、大纲停在「加载中......」，没有错误弹窗。去掉 `markers` 的同结构
文件能正常打开（`主题: 1 / 5`），只留 `markers` 就复现，与具体 marker id 无关
（`tag-orange`/`priority-2`/`task-oct`/`flag-red`/`star-red`/`people-orange`
逐个单测全部失败）。

### 45.2 根因

原版写出器在 `research/asar-src/renderer/2907.js`：

```js
D.length && (N.markers = D.map((e) => ({ markerId: e })))
```

即 `markers` 是**对象数组** `[{"markerId":"priority-3"}, ...]`。本应用此前用
`json!(Vec<String>)` 写成字符串数组 `["priority-3"]`。读取侧早已两种都认
（`parse_markers` 同时接受字符串与 `markerId`/`id` 对象），所以是我们单方面
写出错。字符串形式（含 `org.xmind.ui.marker.*` 前缀）原版一律整份拒收。

### 45.3 修复

`crates/xmind-file/src/xmind.rs`：

- 新增 `markers_json()`：`[{ "markerId": <id> }]`。
- `markers` 不再走通用 `sync_list`（那会把 `__rawMarkers` 原样回填，把缺陷
  抄下去）；只有原始数组**每项都含 markerId** 时才原样保留，否则按对象重写。
  于是「读入旧的字符串写法 → 保存」即可修复文件。
- `labels` 仍是字符串数组，不受影响。

回归：`markers_are_written_as_marker_id_objects`、
`resaving_repairs_legacy_string_markers`（`cargo test -p xmind-file` 15/15）。

### 45.4 验证

- `target/verify/resaved.xmind`（本应用读入旧 test.xmind 再保存）在原版打开
  为 `主题: 5`，截图 `target/verify/xmind-resaved.png`：中心主题左侧 6 个标记、
  分支主题 1 的优先级+旗帜、贴纸图片、标签「超出范围了」、笔记角标 `≡` 全部正常。
- 本应用读回同一文件：`markers` 解析为字符串数组，`image` 正常。

### 45.5 复现/核对脚本（新增）

- `scripts/launch-orig-xmind.py`：**必须传绝对路径**（原版按自身 cwd 解析，
  相对路径会静默不打开，页面停在「加载中」），脚本已 `abspath` 化。
- `scripts/open-check.sh` / `scripts/orig-windows.mjs`：逐文件重启原版并读
  `主题: N` 判定是否加载成功（真正的加载指标；「加载中......」是大纲面板占位，
  不代表失败）。原版有多窗口会叠加，按 URL 里的 `source=file:///...` 区分。
- `scripts/probe-orig-console.mjs`：抢在加载前 attach 所有 target 抓 console；
  实测原版对这类解析失败**不打印任何 console/异常**。

## 46. `test.xmind` 双端截图对照与渲染对齐（2026-11-18，跨账号恢复 session 后）

原版 XMind 23.07（CDP 9222，`launch-orig-xmind.py` 传绝对路径）与 xmind-rs 隔离实例
（CDP 9226，`XMIND_RS_DATA_DIR` + 全新 `WEBVIEW2_USER_DATA_FOLDER`）打开同一
`test.xmind`，视口 1280×820、100% 缩放。截图 `target/verify/orig-test.png`、
`ours-test-initial.png`、`ours-test-final.png`，并排/叠加页
`target/verify/compare-render.html`（`scripts/compare-render.mjs` 生成）。

### 46.1 原版 DOM 实测（`probe-orig-svg.mjs` / `probe-orig-geom.mjs`）

| 元素 | 几何 / 样式 |
| --- | --- |
| 画布 | `rgb(244,248,242)` = `map/properties/svg:fill` `#f4f8f2` |
| 中心主题 | 盒 228×70，marker `<image>` 30×30 at (5,5)，文本 `foreignObject` 120×40 |
| 分支 1 / 2 | 盒 150×46 / 155×46，文本 84/89×24，内边距左 20 上 12 |
| 笔记角标 | 盒**内**右缘 18×18（`topic-info-button`，字形 `≡`），不是右上角外部 |
| 标签 | 盒**外**下方 78×23，`rgba(255,255,255,.7)` 填充 + `rgba(0,0,0,.1)` 描边 |
| 图片主题 | 贴纸 SVG 自带 `width/height` 140×140 / 60×60；原版按原生尺寸绘制 |

图片主题的盒规则（两个样本交叉验证）：内容内边距 **20 / 12 / 18 / 10**，
内容宽 `max(图宽, 标题宽)`，内容高 `图高 + 12 + 24(标题)`，
盒 = `内容宽 + 38` × `内容高 + 22`。140×140 → **178×198**，60×60 →
**128×118**（60 那张标题盒 90px，比图宽，故盒宽由标题决定）。

### 46.2 四个根因与修复

1. **背景白掉**：`SheetTheme::from_value` 用 `colorThemeId` 前缀判 `foreign`，
   `test.xmind` 是外来主题但被本应用改过配色写成 `XMindRS-Forest` →
   `has_theme=false` → 整份 theme 不参与渲染 → 画布白。
   修法：`compute_layout` 把 `sheet_theme.background()` 移出 `has_theme` 分支
   （画布色是 sheet 属性，不属于 style cascade，且 `doc.background` 仍在其后覆盖）。
   没有放宽 `foreign` 判据本身，避免影响 `theme_for()` 写回主题与既有回归。
2. **图片被压成 22px 行内图标**：资源其实已由 `resource_data` 正确读出
   （`naturalWidth` 60/140），但 `.node-image` CSS 限 `max-height:22px`，
   `node_size` 只给图片 `height += 26`。
   修法：`Topic.image_size: Option<(f64,f64)>`（派生数据，`topic_to_json` 不写出）；
   `doc_open` 从资源字节解析 SVG 根 `width/height`（PNG 走 IHDR），
   `doc_set_image` 从资源文件补测；`node_size` 按 §46.1 规则定盒，
   多给 6px 标题余量防裁切；`LaidOutNode` 下发 `imageWidth/imageHeight`；
   前端 `.node.has-image` 改 column 卡片（图上、标题下），
   并把 inline `justifyContent` 让位给 CSS。
3. **笔记角标在盒外右上**：改 `.node-note` 为 `right:19px; top:50%` 的
   18×18 `≡`；`node_size` 为它预留 28px 宽（原版 150/155 盒宽由此复现）。
4. **标签样式与占位**：改白底浅描边、`top: calc(100% + 5px)` 左对齐；
   删掉 `node_size` 里 `labels → height += 18`（原版标签不进盒高）。

### 46.3 验证

- `scripts/ui-render-align.mjs`：**15/15 PASS**（背景 layout + DOM、中心/分支盒、
  两张图片卡片盒、原生尺寸、角标数、标签数），`CDP_PORT=9226`。
- `cargo test --workspace` 全绿（含 15 项 `xmind-file` roundtrip）、
  `tsc --noEmit`、`npm run build:app` 成功。
- 修复后：`#f4f8f2`、236×70 / 149×44 / 149×44 / 178×198 / 129×118。

### 46.4 残余差异（禁称像素级一致）

自研布局引擎的分支垂直间距与原版不同（原版右侧两分支中心距中心 ±65，
本应用 -75/+5），分支标题原版左对齐而本应用居中，中心标记 36px vs 30px。
`50%` 叠加图 `target/verify/render-overlay.png`（平移 +123/−35 后）里的重影
主要来自这些项与两套应用工具栏；改这些常量会波及 17 种骨架与既有回归，本轮未动
（已在 §47 继续处理）。

## 47. 三项残余渲染差异的收敛（2026-11-18，续 §46）

用户要求继续调整 §46.4 的三项差异，不动应用工具栏。原版重启后 CDP 9222，
本应用隔离实例 CDP 9229（`cmp6-data` / `cmp6-wv2`），同一 `test.xmind`、
1280×820、100%。截图 `orig-test-cur.png` / `ours-test-final.png`（上轮）/
`ours-final3.png`（本轮），对比页 `target/verify/compare-render-v2.html`，
叠加图 `render-overlay3.png`。

### 47.1 视口陷阱：原版 DOM 坐标会随 `Emulation` 改变

`shot-orig.mjs` 调用 `Emulation.setDeviceMetricsOverride(1280,820)` 且该设置持续生效。
**截图前** `probe-orig-geom.mjs` 量到中心盒 `(626,436,228,70)`；**截图后**再量变成
`(526,385,228,70)`，整体偏移 `(−100,−51)`。做叠加图必须以后一次为准，否则
平移量会错 100px。本轮正确平移是 `(+119,+20)`（本应用中心盒中心 `521,400`
→ 原版 `640,420`），不是 §46 用的 `(+123,−35)`。

视口统一后的原版盒（中心 `640,420`）：中心 `526,385,228×70`；
右分支 `805,332,150×46` / `805,462,155×46`（中心 y `355 / 485` = ±65）；
左分支 `347,263,128×118` / `297,418,178×198`（中心 y `322 / 517` = −98/+97）。
**关键**：XMind 对称的是「分支中心」，不是「该侧包围盒中心」——两侧盒高不同时
这两个中心并不重合，这是 §46 误判为「栈心偏 19.5px」的原因。

### 47.2 三个根因与修法

1. **分支标题居中**：`test.xmind` 的 `mainTopic/properties/fo:text-align` 明确是
   `left`，但 `SheetTheme::from_value` 因 `colorThemeId: XMindRS-Forest` 判定
   `foreign=false → has_theme=false`，整份 theme 不进 `style_for`。
   §46 只放行背景，样式层仍被跳过。
   修法：`ThemePalette.theme_align: [Option<String>;3]`，`compute_layout` 用
   `sheet_theme.get(depth, fo:text-align)`（**不用 `resolve`**，避免 `defaultStyles`
   回退把无主题文件也改掉）无条件注入；`style_for` 在 sheet.theme 之前应用，
   骨架层与 per-topic patch 仍可覆盖。刻意**不整份放行** theme：其
   `line-class: roundedElbow` / `line-tapered: none` 会改掉已匹配的曲线连线。
2. **中心标记 36px vs 30px**：原版对该文件画 `<image width=30 height=30
   transform(5,5)>`；§43 的 36px / 40px 槽来自原生主题文件，两者并不矛盾——
   主题无法解析时原版回退到 30px。
   修法：`Metrics.marker_icon`（默认 36，`compute_layout` 在
   `!has_theme && sheet.extra 有 theme` 时置 30）；`marker_width()` 用
   `n*(icon+4)+18`，得 40px / 34px 槽；`LaidOutNode.marker_size` 下发，
   前端 `--marker-size` 变量驱动 `.marker-chip` 与图标。中心盒 236 → **230**
   （原版 228，差 2px），原生文件保持 §43 的 36/40 不变。
3. **分支垂直分布**：`test.xmind` 实际结构是 `clockwise`（sheet 无
   `structureClass`，`xmind.rs` 从 root 推断），不是 `Balanced`——第一版条件写
   `== Balanced` 导致规则没触发。原版按分支中心对称且小分支有 130px 最小节距：
   右侧两 46px 盒中心 ±65（节距 130 = 46 + 84），左侧 118/198 卡片 ±97.5
   （节距 195 = 158 + 37，自然堆叠，不触发最小节距）。
   本应用原逻辑把每侧**包围盒**居中于中心主题**顶边**（§24.5 实测规则），
   得到右 −75/+5、左 −152/+42。
   修法：`compute_layout` 的水平堆叠分支中，当结构为
   `Balanced | Clockwise | Anticlockwise`、两侧均分、且一级分支全为叶子时，
   改用 `gaps[i] = max((h_i+h_{i+1})/2 + v_gap, MIN_BRANCH_PITCH=130)`，
   并把分支中心从 `−span/2` 依次按 gap 递进（自动关于根中心对称）。
   **带子树的文件继续走 §24.5 的顶边堆叠**，因此 17 种骨架的既有 bbox 对照不受影响。

### 47.3 验证与残余

- `scripts/ui-render-align.mjs` 扩到 **23/23 PASS**（新增标记尺寸 layout+DOM、
  分支对齐 layout+DOM、左右节距、两侧对称性）；中心盒容差收紧到 ±3。
- `cargo test --workspace` 全绿、`tsc --noEmit` 通过、`npm run build:app` 成功。
- 本轮实测：中心 `230×70`、marker `30`、分支 `149×44` 且 `align=left`、
  右节距 `130`（±65）、左节距 `194`（±97）、两侧相对根中心偏移均为 `0`。
- `render-overlay3.png` 中导图主体（中心盒、四个分支盒、两张插画、连线）已基本重合。
  残余微差：中心盒 230 vs 228、分支 149×44 vs 150×46（1–2px），
  标记白环与 `translateX(4px)` 的数像素错位，图片卡片内边距数像素，
  字体渲染；另有两套应用的工具栏/状态栏（按要求未改）。**仍不声称像素级一致**。

### 47.4 复用提醒

- 构建前必须 `Get-Process xmind-rs | Stop-Process -Force`，否则 cargo 覆盖
  `target/release/xmind-rs.exe` 报 `os error 5 拒绝访问`。
- 每次隔离实例换新的 `WEBVIEW2_USER_DATA_FOLDER` 与 CDP 端口（本轮 9227→9228→9229）。
- 原版 `wait-open.mjs` 可能取到非 test.xmind 的 target 而误报「加载中」；
  以 `probe-orig-geom.mjs <needle>` 能读到主题为准。

## 48. 标记边距 / 标记可点击 / 图片独立选中（2026-11-18，续 §47）

用户提出三点：标记与文字左右边距不对、原版每个标记可点击弹框换同类或删除、
原版贴纸/插图可单独选中并响应右键菜单。

**注意 fixture 已变**：本轮 `test.xmind` 的中心主题带 **4 个** marker
（`task-oct, priority-1, flag-red, star-red`），原版中心盒宽 **324**，
不再是 §46/§47 记录的 228/230（那个是单 marker 版本）。回归基线随文件更新。

### 48.1 标记行的精确内边距

`scripts/probe-orig-interact.mjs` 直读原版 SVG（相对形状盒 `[0,0,324,70]`）：

| 元素 | 相对 x | 说明 |
| --- | --- | --- |
| `topic-content` g | +34（transform +29） | 内容区左右各 inset 29 |
| `topic-marker-group` | +34，宽 126 | 4×30 图标，步长 32（`icon+2`） |
| 4 个 marker | +34 / +66 / +98 / +130 | `transform(5,5)` 白环 path |
| `topic-title` fo | +175 | 与 marker 组间隔 **15px**，宽 120 |
| 形状右边界 | +324 | 标题右侧留 **29px** |

即 `324 = 29 + [5 + 126] + 15 + 120 + 29`。
之前 `marker_width = n*(icon+4)+18` 得到 154，且 node 无 padding，
于是 marker 贴着左边框、标题被 flex 撑到中间偏右（用户说的「左小右大」）。

修法：
- `layout::marker_width` 改为 `(5 + (n-1)*(icon+2) + icon + 15) * pad`
  （4×30 → 146，盒宽 332 → **324**）；
- 新增 `LaidOutNode.marker_pad = h_pad(depth)/2`（中心 29），前端对
  `has-markers` 的 node 用它作真实 CSS `padding-left/right`，并把
  `--text-pad` 置 0、`textAlign` 强制 left、`auto-wrap` 禁用；
  `make_node` 的 `wrap_usable` 同步不收窄，避免行数不一致；
- CSS `.node-markers` 加 `padding-left:5px; margin-right:15px`，
  `.marker-chip` 宽 `icon+2`（最后一个只有 `icon`），图标 `translateX(2px)`。
- 全局 `box-sizing: border-box`，`.node-shape` 是 `position:absolute; left:0`，
  所以加 padding 不会撑大盒子、也不会移动形状。

### 48.2 单个标记点击弹框（原版实测）

`scripts/probe-orig-ui.mjs` 用 CDP `Input.dispatchMouseEvent` 点击
`topic-marker-image:…:star-red`，原版新增：

- `.uk-pop.uk-popover.uk-popover-bottom-center.uk-open`，`223×40`，
  `style="--uk-popover-toggle-width:324px; …"`，即锚定**整个主题盒**下方居中；
- 内容为该 marker **同组全部 7 个** 16px 图标按钮（star-red/orange/yellow/
  green/blue/purple/gray）+ 一个 `uk-icon: trash` 删除按钮；
- 全屏 `.topic-popover-overlay` 透明遮罩；弹框是 toggle，再点一次关闭。

本应用实现：新增 `src/shell/MarkerChipPop.tsx`（同组图标 + 垃圾桶 + overlay +
点外部/Esc 关闭），`MapCanvas` 的 `.marker-chip` 变为可点击按钮
（`onPointerDown stopPropagation` 防止触发主题拖拽），App 维护
`markerChipPop` 状态并通过 `run('setMarkers')` 替换/删除；替换走
`addMarkerExclusive` 保持「同组唯一」。弹框锚点用主题盒
`bottom + 16 / centre`，与 `uk-popover-toggle-width` 一致。

### 48.3 图片独立选中与右键菜单（原版实测）

`scripts/probe-orig-image.mjs` diff 原版 DOM：左键点
`topic-image:a469…` 后新增 **5 个元素**：
`topic-image-outline`（`stroke: rgba(46,189,255,1)`，比图大 1px）+
`topic-image-resize-handle-{up,down}-{left,right}` 四角手柄；
**没有**新增主题选中框 → 图片是独立对象。
右键后 DOM 无任何新增节点，说明是 **Electron 原生菜单**（CDP 读不到），
因此本应用菜单只列能真正落地的行，不伪造不可用项。

实现：`MapCanvas` 给 `.node-image` 加 click / contextmenu（均
`stopPropagation`），App 维护 `selectedImage`；CSS 画蓝色 outline +
4 个 `.image-handle`；`menuModel.buildImageMenu()` 提供
替换图片（本地图片 / 贴纸 / 插画）、拷贝、格式、删除图片、删除主题；
`handleMenuAction` 新增 `image.*` 分支，`Delete` 键在图片选中时删图片而非主题。

### 48.4 另一个渲染差异：标记按组排序

原版画 `priority-1, task-oct, flag-red, star-red`，而 `content.json`
存的是 `task-oct, priority-1, …`。即官方按标记目录的组顺序
（标签/优先级/任务/旗帜/星星/人像/符号）排列，不按文件顺序。
`layout::ordered_markers()` 用稳定排序按前缀归组，`make_node` 下发。

### 48.5 验证与陷阱

- `scripts/ui-render-align.mjs` 扩到 **51/51 PASS**（原 23 项 +
  边距 8 项 + 弹框 8 项 + 图片 6 项 + 顺序/位置等）。
- `cargo test --workspace` 全绿、`tsc --noEmit` 通过、`npm run build:app` 成功。
- **回归脚本陷阱**：不要直接 `invoke('doc_undo')` 撤销改动——
  shell 的 `run()` 才持有 `commit()`，绕过它后端布局已回滚但 React DOM
  仍是旧 marker，后续断言会连锁失败。必须用真实 `Ctrl+Z`
  （`document.body.dispatchEvent(new KeyboardEvent('keydown', …))`）。
- `KeyboardEvent` 必须 dispatch 到 `document.body` 而非 `window`：
  App 的 handler 会对 `event.target` 调 `.closest()`，window 没有该方法。
- 本轮叠加图平移量仍是 `(+119,+20)`（原版中心盒 `478,385` /
  本应用 `359,365`），与 §47 一致。
- 新增脚本：`probe-orig-interact.mjs` / `probe-orig-ui.mjs` /
  `probe-orig-image.mjs` / `shot-interactions.mjs`。

## 49. 概要主题的子主题必须作为分支渲染（2026-11-18，test2.xmind）

用户文件 `test2.xmind` 的概要主题 `d5f95edf…` 带 4 个 `children.attached`
子主题。原版 XMind 23.07（CDP 9222）画出 **13 个 `topic-node`**、
**10 条 `topic-connection`**、1 条 `summary-body-line`；本应用只画 9 个节点，
概要右侧整棵子树消失。

### 49.1 原版实测（窗口最大化、100%）

- 概要主题盒 `[874,482,116,51]`，蓝底 `#0288D1`；花括号
  `[837,470,26,74]`（range `(2,3)` 包住第 3、4 个兄弟）。
- 4 个子主题盒统一 `x=1017`：`y=414/453/492/531`，
  宽 `141/156/164/306`，高 `31/31/31/86`；淡红/淡蓝填充按分支色与
  自身 `svg:fill` 决定。
- 连接组 `[991,429,27,145]`，4 条 `roundedElbow` 红色
  `rgba(242,40,22,1)` 连线从概要右缘 `990` 到子主题左缘 `1017`
  （水平间隙 27px，垂直节距 39px = 31 + 8）。
- 子主题堆栈中心约 `515.5`，比概要盒中心 `507.5` 低 8px；
  说明官方把子主题当作概要主题自己的右侧分支，而不是浮动/外框装饰。

### 49.2 根因

`layout.rs::place_native_summaries()` 只画概要主题本身与花括号：
`collect_native_summary_ids()` 让浮动主题遍历跳过它，`build_edges()`
又在挂概要节点之前就跑完，因此 `sum.children` 从未进入 `placed`，
`Layout.edges` 也不会有概要→子主题的连线。

### 49.3 修复

- 新增 `place_summary_children()`：从概要主题出发递归摆放
  `children.attached`，深度从 3 开始、`Side::Right`、
  `parent_id = Some(父 id)`，水平间隙 `(m.h_gap/2).max(16.0)`（默认 26px），
  垂直按 `subtree_height()` + `m.sub_gap` 堆叠，堆栈中心
  `sy + sh/2 + m.sub_gap`。折叠主题不再向下展开。
- `place_native_summaries()` 改为把「概要节点 + 整棵子树」组成局部
  `Vec<Placed>`，用 `build_edges(..., 空 Anchors, 水平)` 生成连线后
  append 到 `Layout.edges`；概要节点仍 `parent_id=None`（只由花括号连接）。
- 这一步继续放在 `apply_alignment()` 与 stage shift 之后，于是
  `同级主题对齐` 不会把概要子主题拉伸成主树同层宽度；stage 的
  `width/height` 自动因新节点变宽，右侧不再被裁剪。
- 新增回归 `crates/xmind-core/tests/decor.rs::native_summary_children_are_rendered_as_a_branch`：
  断言概要节点恰好 1 个、3 层后代都出现、概要→子/子→孙的边存在、
  子节点在概要右侧且 `parent_id` 正确、花括号仍只有 1 条。

### 49.4 验证

- 本项目修复前 `nodes=9 / edges=6`，修复后 `nodes=13 / edges=10 / frames=1`，
  与原版 13 个 `topic-node` / 10 条 `topic-connection` 对齐。
- 截图：`target/verify/test2-orig-desktop2.png`（原版）、
  `target/verify/test2-ours-before.png`、`target/verify/test2-ours-after.png`。
- `cargo test --workspace --locked` 全绿（decor 9/9）、
  `scripts/ui-render-align.mjs` 仍 **51/51 PASS**、
  `npm run build:app` 成功。
- 残余差异：个别概要子主题因字体度量在本应用里折成两行
  （如「曦云C500 * 8卡 * 64台」高 50px vs 原版 31px），
  属已有字体度量问题，不影响「子主题可见 + 连线正确」这一修复目标。


