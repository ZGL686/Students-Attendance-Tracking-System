# Android 离线 Worker 资源适配

此目录维护原生模板，生成目录 `src-tauri/gen/` 仍不提交 Git。
`scripts/build-android.mjs` 会先运行 `scripts/prepare-android-native.mjs`。
首次使用先运行 `npm run android:init`；生成工程和配置的应用标识必须保持
`cn.guilu.attendance`。模板准备重复执行不改写相同文件；不同内容先保留到
`.local/android-native-backup/` 并在终端明确报告。

`MainActivity` 保留边到边界面设置，在 `onWebViewCreate` 中安装 Worker 请求适配，
销毁前按唯一 owner token 清理。客户端只捕获 WebView 标识和布尔配置，
不持有 Activity / WebView；锁同时保护请求和销毁。支持条件是
`SERVICE_WORKER_BASIC_USAGE` 与 `SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST`。
适配只允许 `GET http(s)://tauri.localhost/offline/…`，拒绝端口、凭据、
路径穿越及其他来源，复用已有 `Rust.handleRequest`，不修改 CSP 或公网权限。

这项修复覆盖 Worker 子资源与页面不同的 Android 请求入口，
不能仅凭桌面模拟器或资源打包校验认定某次真机导入失败由此造成。
识别位置和 SQLite 保存仍需分别验证。

验证入口：

- `npx vitest run tests/android-native-prepare.test.ts`：模板复制、备份、幂等性、
  固定标识、未初始化及目录越界保护。
- 先运行 `node scripts/prepare-android-native.mjs`，再在
  `src-tauri/gen/android/` 执行 `gradlew.bat :app:testUniversalReleaseUnitTest`：
  JVM 白名单测试；编译需要本地 Android / Tauri 构建环境。
- 原生 APK 构建验证 MainActivity 与 Worker 适配的实际编译结果。
  浏览器测试无法替代 Android WebView 真机验收。
