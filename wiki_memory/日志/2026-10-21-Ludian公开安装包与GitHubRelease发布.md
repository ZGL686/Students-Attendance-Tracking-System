---
type: log
status: archived
kind: maintenance
importance: high
updated: 2026-10-21
topic: public-installers-and-github-release
source_logs:
  - "[[日志/2026-10-19-Ludian全应用留白与手机备份排版修复]]"
  - "[[日志/2026-10-21-Ludian远程核对与本地目录清理]]"
supersedes: null
---

# Ludian 公开安装包与 GitHub Release 发布

## 用户要求与版本

- 用户要求将最新 APK、EXE 同时上传远程仓库与 Release。发布前已核对远程列表为空，本地 `main` 与 `origin/main` 一致。
- 现有最新程序均为 0.5.12，实际构建源码为 `9993dcec2d82dd259437a10234bb4b087181f2c3`。核对该提交至发布前主分支的前端、原生、公共资源、构建脚本及配置无差异，复用已验证程序，没有重新编译或修改业务代码。
- Windows ZIP 通过 `scripts/package.ps1` 更新使用说明并重新打包，EXE 字节不变；ZIP 五个条目与对应解压文件逐字节一致。

## 公开资料边界

- Windows 实际文件版本为 0.5.12。检查当前 EXE 的嵌入资源与 release codegen 资源，未发现私人初始化名单、学生数据、数据库或备份；当前 `public/local-seed.json` 不存在。
- Android APK 包名 `cn.guilu.attendance`，版本 0.5.12 / 5012，最低 SDK 24，目标 SDK 36，包含 ARM64 / ARMv7。重新验证实际版本及 v2 签名，与此前发布证书一致；两 ABI 的资源与原已验证包逐项核对，没有私人初始化资料或签名密钥。
- 不上传本地名单、个人数据库、备份、截图、签名配置或密钥。`dist/` 和 `.local/` 继续忽略，仅将明确核验的公开程序复制到 `downloads/v0.5.12/`。

## 仓库与 Release

- 仓库发布提交：`1468b98be8c88e87bcc2db7c94dfdd6f275b713d`，包含 APK、EXE、README、版本清单及 SHA-256 文件；首页增加直接下载入口。
- `downloads/.gitattributes` 明确程序为 binary，版本清单及校验文件使用 LF，保证 Git 文件与 Release 中的字节一致。
- Release：<https://github.com/ZGL686/Students-Attendance-Tracking-System/releases/tag/v0.5.12>。
- Release ID `419473757`，标签 `v0.5.12` 指向上述仓库发布提交，已设为最新版本，`draft=false`、`prerelease=false`；公开时间为 2026-10-21 19:29:53（北京时间）。
- 先创建草稿并上传全部附件，核对服务端大小与 SHA-256 后公开，避免出现缺少附件的公开发行页。

| 附件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Ludian-Windows-0.5.12-x64.exe` | 69,450,752 | `b5cb1b3f95d923b453982b4723000d5ca61edf273cb80e5a82c32f9798602858` |
| `Ludian-Android-0.5.12-universal.apk` | 97,561,864 | `012e54e9901649e6dbb68273a10edc06680d4b9e3d9cfef10627cee68022bb17` |
| `Ludian-Windows-0.5.12-x64.zip` | 60,995,640 | `9d0fb6808a471f44bcaae692ee78fa83747feea81971bc98a4ccf7c2bf74d57d` |
| `release-manifest.json` | 1,400 | `217009b568a198dbaadcbfa887ff8fe97ae7e9204469fa8796b0106d64aa4c8a` |
| `SHA256SUMS.txt` | 382 | `faebce0e56ac6a9cea29db5af4ee551fabd19bcc095aa027672159ba37b30738` |

## 验证与变更

- `npm run check` 通过 ESLint、114 模块边界与循环检查、Prettier、TypeScript；说明文件格式检查及 Git whitespace 检查通过。
- 远程仓库四份程序 / 清单的 Git blob、大小均与本地一致，公开原始文件地址可访问。两份程序各小于 GitHub 100 MiB 限制，GitHub 大文件建议提示未阻止正常推送。
- 发布后核验 `/releases/latest`、标签提交及五个附件：大附件使用 GitHub 服务端 SHA-256 与无授权公开下载地址响应检查；两个小附件实际下载并计算 SHA-256。全部匹配。
- 更新 `README.md`、`docs/使用说明.md`、`docs/项目目录与清理说明.md`；公开目录包含独立下载说明、校验文件和真实构建源码信息，避免把本轮上传写成重新编译。
- 完整本地发布与检查记录位于忽略目录 `.local/github-release-0512/`。现有 Windows / Android 本地发行文件和资料保留。
- 本轮未新增或运行应用测试套件，未新增实体 Android 安装、重启保存或机型兼容性验收；Release 与说明明确记录这一边界。

## 待确认长期记忆

- 本次已授权公开程序采用仓库 `downloads/` 与 GitHub Release 双入口；后续版本是否继续把大二进制纳入 Git 历史，留待后续发布要求确认。
- 后续公开前继续检查私人初始化资源、签名连续性、原构建源码与发布标签，校验资产及实际公开下载入口。
