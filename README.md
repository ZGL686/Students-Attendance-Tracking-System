# Ludian · 班级考勤

面向 Windows 桌面与 Android 手机的本地班级考勤应用。使用 React、TypeScript、Vite 和 Tauri 2，提供周课表、异常考勤登记、多工作台、学期汇总与备份迁移。

当前版本 **0.5.0**：新增 18 套内置视觉主题，支持独立选择明暗模式、预览和应用；课程表可从图片、Excel、CSV 和 PDF 在本机识别导入，检查、修正并确认后保存。不需要登录或云端连接。

保留表格、看板、画廊、列表、日历、保存视图、自定义属性、筛选排序、批量编辑和关联汇总。更名不会改变原数据目录、备份格式或已有记录。

## 使用

本机构建完成后，直接打开 `dist/Ludian-latest/Ludian.exe`，或将 `dist/Ludian-latest.zip` 解压后运行。运行环境为 Windows 10/11 x64，需要 Microsoft Edge WebView2 Runtime。

- 课程表按北京时间显示当前周，支持周次切换、课程详情、添加和编辑课程；每天最多 10 节、学期最多 30 周，支持不连续周和单双周。
- “导入课程”支持 PNG、JPEG、WebP、BMP 图片、`.xlsx`、UTF-8 `.csv` 和 PDF，可选择工作表或页面。本地识别后编辑草稿，默认追加并跳过完全重复项，或明确确认替换当前课表；历史考勤快照继续保留。
- 在“外观与交互”中预览 18 套宫崎骏风、二次元、国漫主题，也可使用经典外观。所有主题随程序提供；明暗模式、字体、字号和减少动效分别设置。
- 点击学生对应类型下的 `+`，登记一次请假、旷课、迟到或早退。每条记录保存日期、时间、课程快照与备注。
- 支持批量登记、补记、查看个人明细、修改、撤销和恢复。统计异常登记次数，未登记不代表已确认出勤。
- 汇总可以按日期及课程筛选，导出 Excel（汇总、明细两个工作表）或 Markdown。
- 导入包含“姓名”“学号”列的 `.xlsx` 或 UTF-8 `.csv`，创建独立工作台。第一张工作表用于名单导入，重复学号或缺失信息会阻止导入。
- 在“学期设置”中随时修改开学日期、作息、总周数、备忘与新增考勤类型。
- 在“数据与备份”中导出完整 JSON；恢复先校验 SHA-256 和数据结构，再创建独立副本，保留已有工作台。

Android 首版面向 Android 7.0 及以上，提供手机课表、学生查询、考勤登记与历史查看。手机与 Windows 通过手动 JSON 备份迁移；不提供云同步或手机端名单 / 课程编辑。Android 环境准备、签名和 APK 构建见 [Android APK 构建说明](docs/Android%20APK%20构建.md)。

完整操作说明见 [使用说明](docs/使用说明.md)。

## 开发

建议 Node.js 24 LTS（质量检查至少需要 22.13+）、Rust MSVC、Visual Studio C++ Build Tools、Windows SDK 和 WebView2。依赖锁定在 `package-lock.json` 和 `src-tauri/Cargo.lock`。

```powershell
npm ci
npm run dev
# http://127.0.0.1:15473
npm run desktop:dev
npm run check
npm test
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run test:native
npm run release
```

浏览器测试默认使用本机 Microsoft Edge。Vite 固定为 15473 端口，并忽略 Rust 构建目录，避免 Windows 文件占用导致监听失败。

桌面验收使用 Node 内置 SQLite 创建虚构学生的旧版快照，单独构建 Debug 版本，并用本机 9333 调试端口连接 WebView2。同时隔离 SQLite 和 WebView2 缓存，写入前校验实际目录。验证升级、旧快照保留、新视图、三种离线字体、侧栏收展、主题 / 字体 / 字号 / 动效偏好、工作台回收站、考勤减号与恢复、原生保存对话框及退出重启。测试完成关闭应用；发行版不会开启此端口。

## 本地名单与仓库边界

公开源码不包含真实学生姓名、学号、考勤数据或个人备份。无本地名单时，源码首次启动提供预置课表及空名单，可在应用里新建工作台导入名单。需要构建个人版时：

```powershell
npm run roster:seed -- "你的班级信息表.xlsx"
npm run release
```

`public/local-seed.json`、`dist/`、`web-dist/`、`.local/` 和数据库均被 Git 忽略。个人版会把本地名单嵌入可执行文件，分发应用即包含名单，请按使用范围保管。初始化仅在数据库完全为空时运行，任何版本更新都不得重新覆盖名单或考勤。

## 数据保存

桌面版通过 Tauri 命令写入 `%APPDATA%/cn.guilu.attendance/attendance.sqlite3`，界面显示实际绝对路径。数据库与程序解压目录分离。SQLite 使用 WAL、FULL 同步和事务；每次写入增加一个完整快照，以版本号拒绝过期写入。单实例插件避免桌面程序重复开启。

浏览器版使用 IndexedDB 的事务快照，与桌面数据互相独立。可以用 JSON 完整备份迁移。界面只有在保存成功后才更新计数；失败会显示错误，原数据不替换。

同一磁盘上的快照不能抵御磁盘故障，因此仍需定期把完整备份保存到其他可靠位置。所有快照保留，长期大量登记时数据库会增长；首版没有自动清理历史。SQLite 文件存在损坏时不自动重建或覆盖。

数据 schema 现为 3；版本 1 / 2 在内存中兼容升级，首次成功写入才产生版本 3 快照，原快照保留。新版备份包含回收站及所有视图、属性与单元格。旧程序会拒绝读取新版数据，避免静默丢弃新字段。

支持通过 `GUILU_DATA_DIR` 指定绝对数据目录用于隔离验收；日常使用无需设置。桌面测试还必须通过 `WEBVIEW2_USER_DATA_FOLDER` 隔离浏览器缓存 / 偏好，使用 `.local/` 内的新目录，并校验 WebView 子进程的实际路径。不允许触碰真实用户数据库。Tauri JSON 的 `dataDirectory` 只接受相对路径，不能用绝对路径代替此运行时隔离。

## 目录

| 路径                                             | 作用                                                       |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `src/model.ts`、`src/seed.ts`                    | 数据约束、北京时区、教学周、初始课表                       |
| `src/storage.ts`、`src/context.tsx`              | 桌面/浏览器存储适配与保存状态                              |
| `src/files.ts`                                   | 名单读取、汇总导出、完整备份                               |
| `src/Timetable.tsx`、`src/features/timetable/`   | 周课表与课程编辑                                           |
| `src/features/timetable-import/`                 | 本地文件解析、OCR、课程草稿校验与事务提交                  |
| `src/features/themes/`、`public/themes/`         | 内置主题定义、预览、应用和背景图片                         |
| `public/offline/`                                | 随发行包提供的 OCR / PDF 运行资源与语言数据                |
| `src/Attendance.tsx`、`src/features/attendance/` | 登记协调、课程表单、个人明细、共用撤销逻辑                 |
| `src/features/workspaces/`                       | 工作台编辑、回收站和恢复                                   |
| `src/features/database/`                         | 数据库页面协调、表格 / 卡片 / 多布局、配置、关联详情与操作 |
| `src/database-schema.ts`、`database-engine.ts`   | 属性类型、保存视图、查询排序、分组、列计算与关联汇总       |
| `src/Reports.tsx`、`src/features/settings/`      | 汇总、学期配置、数据备份及名单导入                         |
| `src/app/`、`src/components/ui/`                 | 导航元信息、应用外壳、班级切换与公共 UI                    |
| `src/preferences/`、`src/styles/`                | 设备偏好、字体、设计变量和按职责拆分的样式                 |
| `src-tauri/src/lib.rs`                           | SQLite 持久化与 Tauri 命令                                 |
| `tests/`                                         | 业务逻辑与端到端测试                                       |
| `scripts/`                                       | 打包、本地名单准备和桌面验收                               |
| `wiki_memory/`                                   | 按用户模板建立的工程记忆                                   |

## 初版边界与依据

初始课表依据用户提供的 2026–2027 第一学期课表和四张截图。开学日期初始为截图中的 2026-09-07，可随时修改；第 9–10 节部分时间为可编辑初始值。只有周次、没有日期节次的实践课程列入备忘，不自动排课。课程支持不连续周次，如 `1-2,4-13`，以及 `1-16单周`、`1-16双周`。

课表导入面向常见课程列表和按星期、节次排列的网格。图片和扫描 PDF 使用本地中文 / 英文 OCR，识别结果须人工核对；缺失的星期、节次或周次不会自动补成有效课程。单个文件不超过 20 MB，PDF 不超过 50 页；旧 `.xls` 需另存为 `.xlsx`，受密码保护的 PDF 需先另存为无密码文件。取消或识别失败不会修改课表，保存失败保留当前草稿。

界面和数据库行为参考 Notion 官方多张产品截图与 [视图、筛选和排序手册](https://www.notion.com/help/views-filters-and-sorts)。来源、实际映射和实现边界见 [设计参考](docs/设计参考.md)。Tauri 环境依据 [官方 Windows 前置条件](https://v2.tauri.app/start/prerequisites/)。

历史验收记录见 [0.4.0 验收](docs/验收记录-0.4.0.md)，前版记录保留。模块边界、质量命令和交互约定见 [架构与交互规范](docs/架构与交互规范.md)。内置字体遵循 SIL OFL 1.1，许可与来源见 [字体说明](public/fonts/README.md)。

首版为单机异常考勤管理，不含多设备同步、完整逐堂点名/出勤率、学校系统自动抓取或自动更新。程序未做商业代码签名。

远程仓库：[ZGL686/-](https://github.com/ZGL686/-.git)。每次完整修改需更新工程日志、完成相关检查、提交并推送。
