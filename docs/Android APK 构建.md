# Ludian Android APK 内测构建

Ludian 0.5.10 使用 Tauri 2 打包 Android 应用，最低支持 Android 7.0（SDK 24）。APK 包含 ARM64 和 ARMv7 两种手机架构，不连接云端；本机数据保存在应用私有目录，手机和 Windows 通过手动传递 JSON 备份迁移。手机课程导入仅接受 Excel / CSV，按字段或网格结构读取，APK 不包含 OCR / PDF 引擎及语言资源。本轮调整底部导航图标与文字的位置，结合系统安全区域避让三按钮和手势区。

## 首次准备

1. 安装 Android Studio，并在 SDK Manager 中安装 Android SDK Platform、Platform Tools、NDK（Side by side）、Build Tools 和 Command-line Tools。
2. 设置 `JAVA_HOME` 指向 Android Studio 自带的 `jbr`，设置 `ANDROID_HOME` 指向 Android SDK，并设置 `NDK_HOME` 指向 SDK 下对应 NDK 版本目录。
3. 安装 Rust Android target：

   ```powershell
   rustup target add aarch64-linux-android armv7-linux-androideabi
   ```

4. 在项目根目录初始化 Android Studio 工程，并生成应用图标资源：

   ```powershell
   npm run android:init
   npm run tauri -- icon public/favicon.svg --output src-tauri/icons
   ```

生成的 `src-tauri/gen/android` 属于本机工具链输出，不纳入 Git；新环境首次构建需运行初始化命令。Android 保留全部内置主题和字体，原始主题 PNG 不进入 APK，使用压缩后的 WebP。从 0.5.9 起，Android 构建排除 `offline/` 的 OCR / PDF Worker、WASM、语言包、PDF 字体和 CMap，以及对应识别代码；桌面构建继续准备并打包这些资源。

`build:android` 先运行 `scripts/prepare-android-native.mjs`，将受版本控制的 `src-tauri/android/` 模板复制到生成工程，保留窗口安全区处理。脚本校验应用标识及路径，已有不同内容先备份到本机 `.local/android-native-backup/`；重复执行不改相同文件。无需在忽略目录手工维护业务兼容代码。课程导入仅使用本地表格解析及现有事务，不需要安装手机 OCR 插件。

0.5.10 的 `MainActivity` 将 `AppWindowInsets` 安装到稳定的 `android.R.id.content`，父容器按系统栏、屏幕缺口与键盘 Insets 的每边最大值留白。处理后的 Insets 归零后继续传给 WebView，避免原生与 CSS 重复留白，并保留键盘隐藏时的更新通知；无需 JavaScript 桥接。准备脚本同时复制对应原生测试模板，细节见 [原生模板说明](../src-tauri/android/README.md) 及 [Android 官方 WebView Insets 指南](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)。

本机已配置 JDK 17、SDK 36、NDK 29 和两种 Rust 手机目标，实际工具链在 `D:\Ludian\-\.local\android-toolchain`，当前仓库下的同名目录并不存在。构建时设置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME` 和 `GRADLE_USER_HOME` 指向实际安装目录；其他电脑按各自安装位置设置。Windows 跨盘符 Kotlin 增量缓存失败时，可在生成工程的 `gradle.properties` 设置 `kotlin.incremental=false`。依赖镜像如需配置，根工程及 `buildSrc` 的插件和依赖仓库都需要检查。

## 签名与构建

内部发布 APK 需使用稳定的 Java Keystore 签名。第一次发布前用 Android Studio JBR 自带的 `keytool` 创建密钥，并把 Keystore 及其口令备份到受控且独立的位置。以后每次更新都要继续使用同一个密钥；丢失后，已安装应用无法通过新 APK 覆盖更新。

Windows 示例：

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -genkey -v -keystore "$env:USERPROFILE\ludian-release.jks" -keyalg RSA -keysize 2048 -validity 10000 -alias ludian
```

创建 `src-tauri/gen/android/keystore.properties`：

```properties
password=填写创建密钥时设置的口令
keyAlias=填写密钥别名
storeFile=C:\\Users\\你的用户名\\安全目录\\ludian-release.jks
```

然后按 [Tauri Android 签名说明](https://v2.tauri.app/distribute/sign/android/) 编辑 `src-tauri/gen/android/app/build.gradle.kts`：在文件顶部加入 `import java.io.FileInputStream` 和 `import java.util.Properties`；在 `android { ... }` 内、`buildTypes` 前加入：

```kotlin
signingConfigs {
    create("release") {
        val signingFile = rootProject.file("keystore.properties")
        val signing = Properties()
        signing.load(FileInputStream(signingFile))
        keyAlias = signing["keyAlias"] as String
        keyPassword = signing["password"] as String
        storeFile = file(signing["storeFile"] as String)
        storePassword = signing["password"] as String
    }
}
```

在 `buildTypes` 的 `getByName("release") { ... }` 中加入 `signingConfig = signingConfigs.getByName("release")`。这两个改动位于 `gen/android`，重新运行 `npm run android:init` 后需检查并重新应用。

Keystore 和 `keystore.properties` 都是私密文件，禁止提交到 Git 或随 APK 分发。`src-tauri/gen/` 已在 `.gitignore` 中排除。Tauri 官方签名流程也要求 Gradle release build type 显式绑定 signing config。

构建通用手机 APK：

```powershell
npm run android:build
```

命令生成单个通用 release APK，包含 ARM64 和 ARMv7。Tauri 生成的 APK 位于 `src-tauri/gen/android/app/build/outputs/apk/` 下的 universal release 目录。未设置签名文件时，不应把调试包当作可持续更新的正式 APK 分发。

## 安装与迁移

- 在 Android 7.0 或更高版本打开 APK，并按系统提示允许从当前文件来源安装应用。
- Windows 首次导出完整 JSON 后，在手机“数据与备份”页通过系统文件选择器导入。首导入保留工作台、学生、课程和考勤 ID。
- 日常同步先将 Windows 新备份传到手机，再从手机导出 JSON 并在 Windows “数据与备份”页选择“合并手机考勤”。冲突会逐条展示，默认保留 Windows 版本。
- JSON 当前未加密，含学生与考勤数据。只通过本人控制的 USB 或本地文件方式传递；导入取消、校验失败或保存失败不会更改已有业务数据。

## 验收建议

- 在 Android 模拟器和至少一台实体设备检查冷启动、重启持久化、屏幕安全区、底部导航、系统返回和 APK 覆盖更新。
- 断网使用全部内置主题，登记、撤销/恢复考勤；完成 Windows→手机首次导入、后续名单/课表更新和手机→Windows 合并。
- 确认签名验证通过，手机存储空间不足或取消文件选择时已有数据仍可用。
- 用虚构课表检查 Excel / CSV 多文件及多工作表追加、重复跳过、冲突提示、全学期网格与重启保存。误选学生名单、空表、只有课程目录或无关文件时，应明确显示原因且不宣称保存成功；混合批次仍保存其中的有效安排。
- 检查最终 APK 的资源和代码中不含 OCR / PDF Worker、WASM、语言包及对应识别模块。浏览器手机模拟器沿用表格导入限制；该界面测试不能替代 Android 覆盖安装及 SQLite 运行验收。
- 检查三按钮及手势导航模式、浅色 / 深色、横竖屏和不同字号，确保底部五项的图标、文字、点击区域完整位于系统导航区上方。记录原生设备验收与浏览器模拟检查各自范围，不将后者称为真机测试。

## 旧产物清理边界

先完成新版 APK 的签名、版本、哈希、资源和覆盖安装兼容性核验，再清理明确的旧安装包及可再生测试产物。本机精确候选清单保存在忽略目录 `.local/nav-0510-cleanup-candidates.json`，记录绝对路径、文件类型、字节数和原因；清单本身不执行删除。清理前重新验证目标仍位于当前仓库，且无构建或测试正在使用它。

保留最新 Windows EXE / ZIP、最新 Android APK 与版本清单、已核对的 Excel 课表、个人原始资料、数据库和备份；签名、工具链及当前构建依赖继续保留。不要递归清空整个 `.local`、`dist` 或 `src-tauri/gen/android`，也不清理 Git 历史或工程记忆。
