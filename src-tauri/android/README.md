# Android 原生模板与表格导入构建

此目录维护原生模板，生成目录 `src-tauri/gen/` 仍不提交 Git。
`scripts/build-android.mjs` 会先运行 `scripts/prepare-android-native.mjs`。
首次使用先运行 `npm run android:init`；生成工程和配置的应用标识必须保持
`cn.guilu.attendance`。模板准备重复执行不改写相同文件；不同内容先保留到
`.local/android-native-backup/` 并在终端明确报告。

`MainActivity` 仅保留边到边界面设置。Android 课程导入使用 Excel / CSV 字段，
不再提供图片 OCR 或 PDF 解析，也不安装旧版的 Worker 离线资源桥接。
准备脚本只移除该桥接的三个已知生成文件，并先将其原内容保留到本地备份目录；
不会递归删除生成目录或用户数据。

`scripts/build-android.mjs` 设置 `LUDIAN_ANDROID_BUILD=1`，跳过离线识别资源准备。
Vite 将 `__LUDIAN_TABLE_IMPORT_ONLY__` 编译为 `true`，剪除图片 / PDF 导入分支，
并拒绝残留 OCR / PDF 模块。复制公共资源时排除整个 `offline/`，保留主题和字体。
网页及桌面构建仍准备并携带原有离线识别资源，不改写或删除 `public/offline/`。

验证入口：

- `npx vitest run tests/android-native-prepare.test.ts tests/android-build-assets.test.ts`：
  模板复制、备份、幂等性、固定标识、过期 Worker 清理、目录越界保护、
  公共资源过滤及 OCR / PDF 模块构建拦截。
- 原生 APK 构建验证简化后的 MainActivity 与表格导入前端。
  浏览器测试无法替代 Android WebView 真机验收。
