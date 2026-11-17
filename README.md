# XMind RS

用 Rust + Tauri 2 重写的 XMind 思维导图编辑器。复用系统 WebView2，不内嵌 Chromium，
启动快、内存占用低；`.xmind` 文件读写保持与原版兼容。

**[⬇ 下载最新版本（Windows x64 免安装 exe）](../../releases/latest)**

## 功能

- **文件保真**：读写 `.xmind` 时未编辑字段原样回填，未知字段与附件进 `other_files`，
  `manifest.json` 与 `resources/` 里的图片等资源完整保留；保存后官方 XMind 可正常打开。
- **17 种骨架**：balanced / clockwise / anticlockwise、logic 左右、tree 左右、org 上下、
  时间轴（横/纵）、鱼骨（左/右头）、brace 左右、tree-table、matrix。
- **18 种主题形状**与层级化主题样式（`theme` → `topic.style`）、彩虹分支、内置主题皮肤、
  文字墨色按背景亮度自动翻转（WCAG 对比度）。
- **原生装饰**：概要（写入 `children.summary` + `summaries[].range` 原生结构）、外框、
  联系线、标注、浮动主题。
- **编辑**：就地编辑与自动折行、拖拽改层级、框选/多选、折叠展开、撤销重做。
- **视图与导出**：演示模式、大纲视图、查找替换；导出 PNG / SVG / Markdown / PDF，
  以及把选中主题变成新中心的分支导出。

## 运行要求

- Windows 10 / 11 x64，需要系统 WebView2 运行时（Win10 1803+ 通常已预装）。
- 无需安装 Node.js / Rust / .NET；发布版是单个自包含 exe（前端与字体已内嵌）。

运行时数据（设置、最近文件、自动备份、日志）统一存放在 `%APPDATA%\xmind-rs\`，
可用 `XMIND_RS_DATA_DIR` 覆盖。程序不读写本机 XMind 的用户配置。

## 从源码构建

```bash
npm install
npm run build:app        # tauri build --no-bundle → target/release/xmind-rs.exe
```

开发模式：`npm run dev`（Vite，端口 1421）+ `npm run tauri dev`。
需要 Rust 工具链与 Tauri 2 的前置依赖。

安装包（NSIS / MSI）：`npm run build:installer`。

## 项目结构

| 路径 | 说明 |
| --- | --- |
| `crates/xmind-core` | 文档模型、布局引擎（骨架几何、折行、主题样式解析）、编辑操作 |
| `crates/xmind-file` | `.xmind` 读写、导出（SVG / Markdown / PDF） |
| `crates/xmind-resources` | 附件与资源存储 |
| `src/` | 前端（React + 自绘 SVG 画布） |
| `src-tauri/` | Tauri 应用外壳与 IPC 命令 |
| `research/` | 官方 XMind 行为的实测记录（`FINDINGS.md`）与对齐常量 |

## 已知差异

相对官方桌面版：字体度量使主题盒宽略窄（二级主题约 258.7px vs 官方 264px），
自动折行阈值随之略提前；浮动子树间距未完全复刻；手绘笔刷纹理、锥形连线 mask
与部分连线箭头未做到像素级一致。

## 字体许可

内嵌 NeverMind、Montserrat、Open Sans，均以 SIL Open Font License 1.1 分发。
许可证见 `public/fonts/LICENSE-*.txt`，发布包内亦附带。字体不得单独提取转售，
仅可随本应用一起分发。
