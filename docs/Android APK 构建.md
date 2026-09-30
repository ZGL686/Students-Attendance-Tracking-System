# Ludian Android APK 内测构建

Ludian 使用 Tauri 2 打包 Android 应用，最低支持 Android 7.0（SDK 24）。首版 APK 包含 ARM64 和 ARMv7 两种手机架构，不连接云端；本机数据保存在应用私有目录，手机和 Windows 通过手动传递 JSON 备份迁移。

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

生成的 `src-tauri/gen/android` 属于本机工具链输出，不纳入 Git；新环境首次构建需运行初始化命令。0.5.1 Android 前端打包全部离线主题及 OCR/PDF 的 Worker、WASM 和中英文语言数据，恢复手机本地导入；构建脚本自动准备这些资源。原始主题 PNG 不进入 APK，使用压缩后的 WebP。

本机已配置 JDK 17、SDK 36、NDK 29 和两种 Rust 手机目标，位于忽略目录 `.local/android-toolchain`。构建时设置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME` 和 `GRADLE_USER_HOME` 指向对应目录。Windows 跨盘符 Kotlin 增量缓存失败时，可在生成工程的 `gradle.properties` 设置 `kotlin.incremental=false`。依赖镜像如需配置，根工程及 `buildSrc` 的插件和依赖仓库都需要检查。

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
