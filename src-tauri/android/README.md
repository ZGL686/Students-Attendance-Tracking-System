# Android 原生模板与表格导入构建

此目录维护原生模板，生成目录 `src-tauri/gen/` 仍不提交 Git。
`scripts/build-android.mjs` 会先运行 `scripts/prepare-android-native.mjs`。
首次使用先运行 `npm run android:init`；生成工程和配置的应用标识必须保持
`cn.guilu.attendance`。模板准备重复执行不改写相同文件；不同内容先保留到
`.local/android-native-backup/` 并在终端明确报告。

`MainActivity` 保留边到边界面设置，并在 `super.onCreate` 后把 `AppWindowInsets`
安装到稳定的 `android.R.id.content` 父容器；Tauri 替换容器内的 WebView 时，监听仍保留。
`AppWindowInsets` 读取系统栏、屏幕缺口和键盘的四边 Insets，按每边最大值增加父容器
padding，不将键盘高度与系统导航栏重复相加。没有引入 JavaScript 桥接。

已在原生父容器处理的 Insets 通过 `WindowInsetsCompat.Builder` 归零后继续传给
WebView，避免 CSS 再加同一份安全区。不能简单返回 `CONSUMED` 阻断后续通知，
否则键盘隐藏后 WebView 可能仍保留旧留白。实现依据
[Android WebView Insets 说明](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)。
浏览器手机模拟器仍使用模拟安全区；真实手机不依赖固定型号或硬编码系统栏高度。

准备脚本自动复制 `MainActivity.kt`、`AppWindowInsets.kt` 和
`test/AppWindowInsetsTest.kt` 到对应生成目录。不要直接修改生成副本作为长期修复，
以免重新初始化或构建时丢失改动。

Android 课程导入使用 Excel / CSV 字段，不再提供图片 OCR 或 PDF 解析，
也不安装旧版的 Worker 离线资源桥接。
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
- 原生单元测试验证 Insets 的四边合并及键盘行为；原生 APK 构建验证 MainActivity、
  AppWindowInsets 与表格导入前端。
  浏览器测试无法替代 Android WebView 真机验收。
