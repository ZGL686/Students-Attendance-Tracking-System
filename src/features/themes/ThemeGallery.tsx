import { Check, Image, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { prepareWallpaper } from '../../preferences/wallpaper';
import { defaultGlassTransparency } from '../../preferences/model';
import { Button, Modal } from '../../components/ui';
import { usePreferences } from '../../preferences/PreferencesProvider';
import { builtinThemes, findBuiltinTheme, themeCategories } from './builtins';
import { themeStyles } from './runtime';
import type { BuiltinTheme, ThemeDefinition } from './schema';
import '../../styles/theme-packs.css';

function ThemePreview({
  theme,
  dark,
  wallpaper,
}: {
  theme: BuiltinTheme | null;
  dark: boolean;
  wallpaper?: string;
}) {
  return (
    <div
      className={`pack-preview ${theme ? 'decorated' : ''}`}
      data-preview-mode={dark ? 'dark' : 'light'}
      style={theme ? themeStyles(theme, dark) : undefined}
    >
      {(theme || wallpaper) && (
        <img src={wallpaper || theme?.imageUrl} alt="" className="pack-preview-backdrop" />
      )}
      <div className="pack-preview-sidebar">
        <strong>Ludian</strong>
        <span>本周课表</span>
        <span>考勤登记</span>
        <span>班级数据</span>
      </div>
      <div className="pack-preview-main">
        <span className="pack-preview-eyebrow">记录日常 · 留下成长</span>
        <h4>今天，也从容一点。</h4>
        <div className="pack-preview-cells">
          <span>
            09:20
            <br />
            <strong>课堂时光</strong>
          </span>
          <span>
            14:00
            <br />
            <strong>新的收获</strong>
          </span>
        </div>
        <span className="pack-preview-action">开始记录</span>
      </div>
    </div>
  );
}
export function ThemeGallery() {
  const { preferences, setPreferences } = usePreferences();
  const [preview, setPreview] = useState<BuiltinTheme | 'classic' | 'custom' | null>(null);
  const wallpaperInput = useRef<HTMLInputElement>(null);
  const [wallpaperBusy, setWallpaperBusy] = useState(false);
  const [wallpaperError, setWallpaperError] = useState('');
  const transparency = preferences.glassTransparency ?? defaultGlassTransparency;
  async function upload(file?: File) {
    if (!file) return;
    setWallpaperBusy(true);
    setWallpaperError('');
    try {
      setPreferences({
        wallpaper: await prepareWallpaper(file),
        themePackId: 'custom',
        themePackVersion: '1.0.0',
      });
      setFilter('all');
    } catch (error) {
      setWallpaperError(error instanceof Error ? error.message : String(error));
    } finally {
      setWallpaperBusy(false);
    }
  }
  const [previewDark, setPreviewDark] = useState(false);
  const [filter, setFilter] = useState<'all' | ThemeDefinition['category']>('all');
  const themes = builtinThemes.filter(
    (theme) => filter === 'all' || theme.definition.category === filter,
  );
  function openPreview(theme: BuiltinTheme | 'classic' | 'custom') {
    setPreviewDark(
      preferences.theme === 'dark' ||
        (preferences.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches),
    );
    setPreview(theme);
  }
  function apply() {
    if (!preview) return;
    setPreferences({
      themePackId: typeof preview === 'string' ? preview : preview.definition.id,
      themePackVersion: typeof preview === 'string' ? '1.0.0' : preview.definition.version,
    });
    setPreview(null);
  }
  return (
    <section className="appearance-section theme-library">
      <div className="appearance-heading">
        <div>
          <h3>让日常有自己的风景</h3>
          <p>
            {builtinThemes.length}{' '}
            套内置主题与自定义图片主题在这里统一切换，每次使用一套。明暗、字体与动效继续由你决定。
          </p>
        </div>
      </div>
      <label className="glass-control">
        <span>
          玻璃透明度 <strong>{transparency}%</strong>
        </span>
        <input
          type="range"
          aria-label="玻璃透明度"
          min={0}
          max={70}
          step={1}
          value={transparency}
          onChange={(event) => setPreferences({ glassTransparency: Number(event.target.value) })}
        />
        <span className="glass-control-hints" aria-hidden="true">
          <small>底板更实</small>
          <small>主题更明显</small>
        </span>
      </label>
      <p className="appearance-note">
        对内置和自定义主题同时生效。提高透明度，卡片后方的主题图片会更清楚；切换主题会保留此设置。
      </p>
      <div className="pack-filter" role="group" aria-label="主题风格">
        <Button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          全部主题
        </Button>
        {Object.entries(themeCategories).map(([key, label]) => (
          <Button
            key={key}
            aria-pressed={filter === key}
            onClick={() => setFilter(key as ThemeDefinition['category'])}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="pack-count" aria-live="polite">
        {filter === 'all'
          ? `${themes.length} 套内置主题 · 经典外观 · 自定义主题`
          : `${themeCategories[filter]} · ${themes.length} 套主题`}
      </p>
      <input
        ref={wallpaperInput}
        type="file"
        accept="image/*"
        hidden
        aria-label="上传自定义主题图片"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void upload(file);
        }}
      />
      <div className="pack-grid">
        {filter === 'all' && (
          <Button
            className="pack-card"
            disabled={wallpaperBusy}
            aria-label={preferences.wallpaper ? '预览自定义主题' : '上传自定义主题'}
            aria-pressed={preferences.themePackId === 'custom'}
            onClick={() =>
              preferences.wallpaper ? openPreview('custom') : wallpaperInput.current?.click()
            }
          >
            {preferences.wallpaper ? (
              <img className="pack-card-image" src={preferences.wallpaper} alt="" />
            ) : (
              <div className="pack-card-image classic-swatch">
                <Image size={28} />
                <span>选择你喜欢的图片</span>
              </div>
            )}
            <span className="pack-card-copy">
              <strong>
                自定义主题 {preferences.themePackId === 'custom' && <Check size={16} />}
              </strong>
              <small>
                {wallpaperBusy
                  ? '正在处理图片…'
                  : preferences.wallpaper
                    ? '已保存 · 可随时切换回来'
                    : '从相册或文件选择图片'}
              </small>
            </span>
          </Button>
        )}
        {filter === 'all' && (
          <Button
            className="pack-card classic-card"
            onClick={() => openPreview('classic')}
            aria-label="预览经典主题"
            aria-pressed={preferences.themePackId === 'classic'}
          >
            <div className="pack-card-image classic-swatch">
              <Image size={28} />
              <span>简单、专注、熟悉。</span>
            </div>
            <span className="pack-card-copy">
              <strong>
                经典 Ludian {preferences.themePackId === 'classic' && <Check size={16} />}
              </strong>
              <small>原有外观 · 始终可用</small>
            </span>
          </Button>
        )}
        {themes.map((theme) => (
          <Button
            key={theme.definition.id}
            className="pack-card"
            onClick={() => openPreview(theme)}
            aria-label={`预览${theme.definition.name}`}
            aria-pressed={preferences.themePackId === theme.definition.id}
          >
            <img className="pack-card-image" src={theme.imageUrl} alt="" loading="lazy" />
            <span className="pack-card-copy">
              <strong>
                {theme.definition.name}
                {preferences.themePackId === theme.definition.id && <Check size={16} />}
              </strong>
              <small>{themeCategories[theme.definition.category]} · 内置主题</small>
            </span>
          </Button>
        ))}
      </div>
      {preferences.wallpaper && (
        <div className="wallpaper-actions">
          <Button disabled={wallpaperBusy} onClick={() => wallpaperInput.current?.click()}>
            更换自定义主题图片
          </Button>
          <Button
            disabled={wallpaperBusy}
            onClick={() =>
              setPreferences({
                wallpaper: '',
                ...(preferences.themePackId === 'custom'
                  ? { themePackId: 'classic', themePackVersion: '1.0.0' }
                  : {}),
              })
            }
          >
            删除自定义主题
          </Button>
        </div>
      )}
      {wallpaperError && (
        <p className="form-error" role="alert">
          {wallpaperError}
        </p>
      )}
      <p className="appearance-note">内置主题可离线使用，自定义图片仅保存在这台设备。</p>
      {preferences.themePackId !== 'classic' &&
        preferences.themePackId !== 'custom' &&
        !findBuiltinTheme(preferences.themePackId) && (
          <p className="appearance-note">
            之前选择的主题不在本版中，已使用经典外观，可重新选择喜欢的主题。
          </p>
        )}
      {preview && (
        <Modal
          title={
            preview === 'classic'
              ? '经典 Ludian'
              : preview === 'custom'
                ? '自定义主题'
                : preview.definition.name
          }
          subtitle={
            preview === 'classic'
              ? '熟悉的简洁外观，保持清晰与专注。'
              : preview === 'custom'
                ? '使用自己的图片，与内置视觉主题自由切换。'
                : preview.definition.description
          }
          onClose={() => setPreview(null)}
          wide
        >
          <div className="pack-preview-toggle">
            <span>
              <Sparkles size={16} />
              主题预览
            </span>
            <label className="check-label">
              <input
                type="checkbox"
                checked={previewDark}
                onChange={(event) => setPreviewDark(event.target.checked)}
              />
              预览深色
            </label>
          </div>
          <ThemePreview
            theme={typeof preview === 'string' ? null : preview}
            dark={previewDark}
            wallpaper={preview === 'custom' ? preferences.wallpaper : undefined}
          />
          <p className="appearance-note">
            预览不会更改当前界面。应用主题后，继续使用你选择的明暗、字体和动效设置。
          </p>
          <div className="pack-preview-footer">
            <Button onClick={() => setPreview(null)}>取消</Button>
            <Button className="primary" onClick={apply}>
              应用主题
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
