---
type: moc
status: active
kind: process
importance: high
updated: 2026-10-07
topic: work-log-index
source_logs: []
supersedes: null
---

# 工作日志 MOC

> 单一工作日志索引，按更新时间倒序。任务类型通过 `kind` 元数据区分。

| 时间 | 类型 | 目标 | 状态 | 主题 | 日志 |
| --- | --- | --- | --- | --- | --- |
| 2026-10-07 | maintenance | 为当前最新 Android 发布代码构建签名通用 APK。 | archived | ludian-0-5-5-android-apk-release | [[日志/2026-10-07-Ludian-0.5.5-Android-APK构建.md|Ludian 0.5.5 Android APK 构建]] |
| 2026-10-03 | feature | 简化移动端课表选择；修复识别失败时只有报错、没有可继续操作的问题；让考勤等文字记录在自定义壁纸下保持清晰。 | archived | ludian-simple-course-import-and-opaque-records | [[日志/2026-10-03-Ludian课表导入兜底与记录不透明.md|Ludian 课表导入兜底与记录不透明]] |
| 2026-10-03 | feature | 按用户提供的改进说明优化手机课表、课程导入、考勤记录显示，并增加自定义壁纸与玻璃透明度。 | archived | ludian-mobile-timetable-import-wallpaper | [[日志/2026-10-03-Ludian手机课表导入与壁纸改进.md|2026-10-03｜Ludian 手机课表、导入与壁纸改进]] |
| 2026-10-03 | feature | 统一自定义与内置主题；按用户视频消除手机学生数据库的横向滑动；简化课程导入；在学生页直接导入名单，交付 0.5.4 安装包。 | archived | ludian-unified-themes-direct-mobile-data | [[日志/2026-10-03-Ludian主题切换与手机数据直显.md|Ludian 主题切换与手机数据直显]] |
| 2026-10-03 | maintenance | 补齐原生构建环境，将本轮功能改进打入 Windows 与 Android，并覆盖用户本地最新发行文件。 | archived | ludian-0-5-3-installer-release | [[日志/2026-10-03-Ludian-0.5.3本地安装包发布.md|Ludian 0.5.3 本地安装包发布]] |
| 2026-10-03 | maintenance | 按用户要求更新本地 `dist` 中的 Windows EXE 与 Android APK，使其包含最新手机课表、导入、记录表格和壁纸改动。 | active | ludian-0-5-3-local-installer-build | [[日志/2026-10-03-Ludian-0.5.3安装包构建准备.md|2026-10-03｜Ludian 0.5.3 安装包构建准备]] |
| 2026-09-30 | feature | 按用户后续要求重新排版手机界面，符合手机屏幕与操作习惯，并尽可能保留桌面功能。 | archived | ludian-mobile-full-workflows | [[日志/2026-09-30-Ludian手机完整交互改造.md|2026-09-30｜Ludian 手机完整交互改造]] |
| 2026-09-28 | feature | 为 Ludian 增加 Android 手机离线运行、考勤与可审查的手动迁移流程。 | archived | ludian-android-offline-app | [[日志/2026-09-28-Ludian安卓离线版.md|2026-09-28｜Ludian 安卓离线版]] |
| 2026-09-27 | feature | 增加完整视觉主题和本地课表文件导入，保留旧数据、历史考勤与设备偏好。 | archived | ludian-bundled-themes-offline-timetable-import | [[日志/2026-09-27-Ludian内置主题与离线课表导入.md|2026-09-27｜Ludian 内置主题与离线课表导入]] |
| 2026-09-24 | feature | 工作台可编辑与删除；主题支持跟随系统 / 浅色 / 深色；考勤登记具备加号与撤销减号，保持公共模块和数据兼容。 | archived | workspace-management-theme-attendance-correction | [[日志/2026-09-24-工作台管理主题与考勤撤销.md|2026-09-24｜工作台管理、主题与考勤撤销]] |
| 2026-09-24 | maintenance | - | archived | external-lab-report-document | [[日志/2026-09-24-外部实验报告填写.md|2026-09-24｜外部实验报告填写]] |
| 2026-09-24 | maintenance | 获取 GitHub `origin/main` 最新提交，并生成最新的 `dist/Ludian-latest` 与 `dist/Ludian-latest.zip`。 | archived | sync-remote-and-build-0-4-0 | [[日志/2026-09-24-同步远程并构建0.4.0正式包.md|2026-09-24｜同步远程并构建 0.4.0 正式包]] |
| 2026-09-22 | maintenance | 重新生成 `dist/Ludian-latest` 与 `dist/Ludian-latest.zip`，确认压缩包、解压目录和正式 Windows 程序可交付。 | archived | ludian-release-rebuild | [[日志/2026-09-22-Ludian正式包重建.md|2026-09-22｜Ludian 正式包重建]] |
| 2026-09-20 | feature | 依据用户需求、课表、四张截图和班级学生表构建初版 Windows 考勤应用。 | archived | attendance-initial-release | [[日志/2026-09-20-班级考勤初版.md|2026-09-20｜班级考勤初版]] |
| 2026-09-20 | feature | 根据用户反馈，进一步查看 Notion 官方 UI 图片和数据库手册，重做色调、布局与数据库交互，改善字体观感。 | archived | notion-database-redesign | [[日志/2026-09-20-Notion界面与数据库改造.md|2026-09-20｜Notion 界面与数据库改造]] |
| 2026-09-20 | feature | 修复点击收起侧栏后的白屏，简化左上角，提供不同字体和交互反馈，从公共模块及质量检查维护整体可维护性。 | archived | ludian-shell-preferences-modularity | [[日志/2026-09-20-Ludian交互与模块化改造.md|2026-09-20｜Ludian 交互与模块化改造]] |

## 使用方式

- 由 `python 工具/memory_lint.py index` 生成或刷新。
- 查询时先阅读当前状态，再按关键词定位日志。
- 历史日志是审计记录，不应直接覆盖当前状态。

## 入口

- [[README|工程 Agent 记忆系统]]
- [[AGENTS|记忆维护协议]]
- [[日志/README|工作日志说明]]
- [[当前状态/项目概览|当前项目概览]]
- [[当前状态/系统架构|当前系统架构]]
